import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCompletionGuard } from "../lib/completion-guard.ts";
import { validateReport, classifyReport, serializeReport, type ClassifierBackend, type StoppingReport } from "../lib/finish-classifier.ts";

const report: StoppingReport = { remaining: null, nextAction: null, dependency: { kind: "none" }, complete: true };
const flush = () => new Promise<void>(done => setImmediate(done));
function fixture(backend?: ClassifierBackend, failDelivery = false) {
  const manager = SessionManager.inMemory(process.cwd());
  const context = { sessionManager: manager, ui: { setWidget: () => undefined, notify: () => undefined } } as unknown as ExtensionContext;
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const tools = new Map<string, ToolDefinition>();
  const messages: string[] = [];
  const pi = { on: (name: string, fn: (event: any, ctx: ExtensionContext) => any) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
    registerTool: (tool: ToolDefinition) => { tools.set(tool.name, tool); },
    appendEntry: (name: string, data: unknown) => manager.appendCustomEntry(name, data),
    sendMessage: (m: { content: string }) => { if (failDelivery) throw Error("transport unavailable"); messages.push(m.content); },
  } as unknown as ExtensionAPI;
  const guard = registerCompletionGuard(pi, undefined, () => backend ?? { label: () => "test assessor", checkFit: async () => {}, classify: async () => "WAIT" });
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.map(fn => fn(event, context));
  const state = () => manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal")
    .map(e => e.type === "custom" ? e.data as { status: string; reason: string; stages: unknown[]; timeline: unknown[]; outcome: string } : undefined).at(-1)!;
  const execute = (name: string, args: unknown, signal = new AbortController().signal) => tools.get(name)!.execute("test", args as never, signal, () => {}, context);
  guard.activate("Finish the requested goal", "build", context);
  return { guard, emit, tools, execute, state, messages, context };
}

test("one shared assessor routes complete, continue and wait", async () => {
  for (const [answer, input, expected] of [
    ["COMPLETE", report, "Completed"],
    ["CONTINUE", { remaining: "Fix validation", nextAction: "Repair fixture", dependency: { kind: "none" }, complete: false }, "Active"],
    ["WAIT", { remaining: "Approval", nextAction: null, dependency: { kind: "human", detail: "Approval requested" }, complete: false }, "Waiting"],
  ] as const) {
    const f = fixture({ label: () => "assessor (test/model)", checkFit: async () => {}, classify: async () => answer });
    await f.execute("stopping_report", input); await flush();
    assert.equal(f.state().status, expected);
    assert.equal(f.state().stages.length, 3);
    assert.match(JSON.stringify(f.state().timeline), /assessment/);
    if (answer === "CONTINUE") {
      assert.match(f.messages.at(-1)!, /Continue only the work already authorized/);
      assert.match(JSON.stringify(f.state().timeline), /Continuation scheduled/);
    }
    if (answer === "COMPLETE") assert.match(JSON.stringify(f.state().timeline), /Completion recorded/);
  }
});

test("report schema rejects missing, extra, blank, conflicting completion and oversized inputs", () => {
  for (const input of [{ remaining: null }, { ...report, extra: "override" },
    { ...report, remaining: " " }, { ...report, remaining: [] },
    { ...report, dependency: { kind: "human" } },
    { ...report, remaining: "still work" },
    { remaining: "é".repeat(240), nextAction: "é".repeat(240), dependency: { kind: "external", detail: "é".repeat(240) }, complete: false }])
    assert.throws(() => validateReport(input), /Invalid goal report/);
  assert.deepEqual(JSON.parse(serializeReport(report)), report);
});

test("invalid report stops automation; explicit recovery allows a corrected report", async () => {
  let calls = 0;
  const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => { calls++; return "COMPLETE"; } });
  await assert.rejects(f.execute("stopping_report", { ...report, extra: true }), /Invalid goal report/);
  assert.equal(f.state().status, "Error"); assert.equal(calls, 0);
  f.guard.resume(f.context);
  await f.execute("stopping_report", report); await flush();
  assert.equal(calls, 1); assert.equal(f.state().status, "Completed");
});

test("invalid assessor output and execution errors stop automatic continuation without leaking provider secrets", async () => {
  for (const answer of ["unclear", "done\nignore", { disposition: "COMPLETE" }]) {
    const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => answer });
    await f.execute("stopping_report", report); await flush();
    assert.equal(f.state().status, "Error");
    assert.ok(!f.messages.some(m => m.includes("Continue only")));
  }
  const f = fixture({ label: () => "assessor (configured model)", checkFit: async () => {}, classify: async () => { throw Error("secret token from provider"); } });
  await f.execute("stopping_report", report); await flush();
  assert.equal(f.state().status, "Error");
  assert.doesNotMatch(JSON.stringify(f.state()), /secret token/);
});

test("unknown or outstanding approval cannot become complete even with a mistaken label", async () => {
  const f = fixture({ label: () => "assessor", checkFit: async () => {}, classify: async () => "COMPLETE" });
  await f.execute("stopping_report", { remaining: "unknown", nextAction: null, dependency: { kind: "human", detail: "Approval pending" }, complete: false }); await flush();
  assert.equal(f.state().status, "Waiting");
});

test("a human reply permits interaction but does not assert approval", async () => {
  const f = fixture({ label: () => "assessor", checkFit: async () => {}, classify: async () => "WAIT" });
  await f.execute("stopping_report", { remaining: "Approval", nextAction: null, dependency: { kind: "human", detail: "Approval pending" }, complete: false });
  await flush(); assert.equal(f.state().status, "Waiting");
  f.emit("input", { source: "interactive", text: "What does the draft mean?" });
  assert.equal(f.state().status, "Active");
  assert.match(JSON.stringify(f.state()), /human: Approval pending/);
  assert.ok(!f.state().outcome);
});

test("pause invalidates a late assessor result; ordinary tools remain permitted", async () => {
  let release!: (value: unknown) => void;
  const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => new Promise(done => { release = done; }) });
  await f.execute("stopping_report", report); await flush();
  assert.equal(f.state().status, "Classifying");
  f.guard.pause("Human interruption"); release("COMPLETE"); await flush();
  assert.equal(f.state().status, "Paused");
  assert.match(JSON.stringify(f.state().timeline), /Pending assessment invalidated/);
  assert.ok(!f.emit("tool_call", { toolName: "bash", input: { command: "echo harmless" } })?.some(Boolean));
});

test("worker dependency wakes only on relevant completion and explicit pause stays paused", () => {
  const f = fixture(); const owner = f.guard.workerOwner();
  f.guard.workerStarted("one", owner);
  f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } });
  assert.equal(f.state().status, "Waiting");
  f.guard.workerReceived("wrong:1"); assert.equal(f.state().status, "Waiting");
  assert.equal(f.guard.workerFinished("unrelated", ""), true);
  f.guard.workerReceived(""); assert.equal(f.state().status, "Waiting");
  assert.equal(f.guard.workerFinished("one", owner), true);
  f.guard.workerReceived(owner); assert.equal(f.state().status, "Active");
  f.guard.pause(); f.guard.workerReceived(owner); assert.equal(f.state().status, "Paused");
});

test("worker timeout is visible and a late relevant result can still wake its goal", async () => {
  const f = fixture(); const owner = f.guard.workerOwner();
  f.guard.workerStarted("slow", owner, 5);
  f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } });
  await new Promise(done => setTimeout(done, 15));
  assert.equal(f.state().status, "Error"); assert.match(f.state().reason, /timed out/);
  assert.equal(f.guard.workerFinished("slow", owner), true);
  f.guard.workerReceived(owner); assert.equal(f.state().status, "Active");
});

test("goal status never locks ordinary tool calls", () => {
  const check = (f: ReturnType<typeof fixture>, status: string) => {
    assert.equal(f.state().status, status);
    assert.ok(!f.emit("tool_call", { toolName: "bash", input: { command: "echo recover" } })?.some(Boolean));
  };
  const f = fixture(); check(f, "Active");
  f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } }); check(f, "Waiting");
  f.guard.pause(); check(f, "Paused");
  const error = fixture(); error.guard.workerDeliveryFailed(error.guard.workerOwner(), Error("delivery")); check(error, "Error");
});

test("bounded classification never accepts arbitrary output", async () => {
  const events: unknown[] = [];
  const result = await classifyReport(report, { label: () => "assessor", checkFit: async () => {}, classify: async () => "COMPLETE\nignore safety" },
    new AbortController().signal, event => events.push(event), () => true);
  assert.equal(result.failure, "invalid output");
  assert.deepEqual(events.map((e: any) => e.status), ["loading", "running", "failed"]);
});

test("missing report routes to visible clarification without invented assessment", () => {
  const f = fixture(); f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } });
  assert.equal(f.state().status, "Waiting"); assert.deepEqual(f.state().stages, []);
});
