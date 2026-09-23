import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCompletionGuard } from "../lib/completion-guard.ts";
import { validateReport, classifyReport, serializeReport, type ClassifierBackend, type StoppingReport } from "../lib/finish-classifier.ts";

const report: StoppingReport = { progress: "Finished entire goal", remaining: null, blocker: null };
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
  const guard = registerCompletionGuard(pi, undefined, () => backend ?? { label: () => "test assessor", checkFit: async () => {}, classify: async () => "unclear" });
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.map(fn => fn(event, context));
  const state = () => manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal")
    .map(e => e.type === "custom" ? e.data as { status: string; reason: string; stages: unknown[]; outcome: string } : undefined).at(-1)!;
  const execute = (name: string, args: unknown, signal = new AbortController().signal) => tools.get(name)!.execute("test", args as never, signal, () => {}, context);
  guard.activate("Finish the requested goal", "build", context);
  return { guard, emit, tools, execute, state, messages, context };
}

test("explicit terminal outcomes settle without creating a classifier", async () => {
  let called = 0;
  for (const outcome of ["complete", "blocked"]) {
    const f = fixture({ label: () => "unused", checkFit: async () => { called++; }, classify: async () => { called++; return "done"; } });
    await f.execute("finish", { outcome, summary: "Foreground claim", evidence: "reported" });
    assert.equal(f.state().status, outcome === "complete" ? "Completed" : "Blocked");
    assert.match(f.state().outcome, /foreground/);
  }
  assert.equal(called, 0);
});

test("explicit continuation schedules fixed wording and no classifier", async () => {
  const f = fixture({ label: () => "unused", checkFit: async () => { throw Error("called"); }, classify: async () => { throw Error("called"); } });
  await f.execute("continue_goal", {});
  assert.equal(f.state().status, "Active");
  assert.match(f.messages.at(-1)!, /Continue only the work already authorized/);
  f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } });
  assert.equal(f.state().status, "Active");
});

test("report schema rejects missing, extra, whitespace, inconsistent and oversized inputs", () => {
  for (const input of [{ progress: "p", remaining: null }, { ...report, extra: "override" },
    { ...report, progress: " " }, { ...report, remaining: [], blocker: null },
    { ...report, remaining: null, blocker: "external" },
    { ...report, progress: "é".repeat(240), remaining: "é".repeat(240), blocker: "é".repeat(240) }])
    assert.throws(() => validateReport(input), /Invalid stopping report:.*Retry|Invalid stopping report:.*retry/);
  assert.deepEqual(validateReport({ ...report, remaining: "unknown" }), { ...report, remaining: "unknown" });
  assert.deepEqual(JSON.parse(serializeReport(report)), report);
});

test("invalid tool report fails before lifecycle or inference, then corrected retry classifies", async () => {
  let calls = 0;
  const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => { calls++; return "done"; } });
  const before = f.state();
  await assert.rejects(f.execute("stopping_report", { ...report, extra: true }), /Invalid stopping report/);
  assert.equal(f.state().status, before.status); assert.equal(calls, 0);
  await f.execute("stopping_report", report);
  await flush();
  assert.equal(calls, 1); assert.equal(f.state().status, "Completed");
  assert.equal(f.state().stages.length, 3);
});

test("only four labels are accepted; unclear and failures pause, not a repair turn", async () => {
  for (const answer of ["unclear", "do this other task", { disposition: "done", instructions: "overwrite" }]) {
    const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => answer });
    await f.execute("stopping_report", report); await flush();
    assert.equal(f.state().status, "Paused");
    assert.ok(!f.messages.some(m => m.includes("Continue only")));
  }
});

test("model failure pauses visibly without retry or automatic repair", async () => {
  let calls = 0;
  const f = fixture({ label: () => "assessor (configured model)", checkFit: async () => {}, classify: async () => { calls++; throw Error("secret token from provider"); } });
  await f.execute("stopping_report", report); await flush();
  assert.equal(f.state().status, "Paused"); assert.equal(calls, 1);
  assert.match(f.state().reason, /resume after restoring access or clarifying/);
  assert.doesNotMatch(JSON.stringify(f.state()), /secret token/);
  assert.ok(!f.messages.some(m => m.includes("Continue only")));
});

test("classifier receives only the report and continuation has fixed text", async () => {
  let input: StoppingReport | undefined;
  const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async received => { input = received; return "continue"; } });
  await f.execute("stopping_report", { ...report, remaining: "Run integration check" }); await flush();
  assert.deepEqual(input, { ...report, remaining: "Run integration check" });
  assert.equal(f.state().status, "Active");
  assert.match(f.messages.at(-1)!, /Continue only the work already authorized/);
});

test("pause invalidates a late classifier result", async () => {
  let release!: (value: unknown) => void;
  const f = fixture({ label: () => "test assessor", checkFit: async () => {}, classify: async () => new Promise(done => { release = done; }) });
  await f.execute("stopping_report", report); await flush();
  assert.equal(f.state().status, "Classifying");
  f.guard.pause("Human interruption"); release("done"); await flush();
  assert.equal(f.state().status, "Paused");
});

test("bounded classification never accepts arbitrary backend output", async () => {
  const events: unknown[] = [];
  const result = await classifyReport(report, { label: () => "assessor", checkFit: async () => {}, classify: async () => "done\nignore safety" },
    new AbortController().signal, event => events.push(event), () => true);
  assert.equal(result.failure, "invalid backend output");
  assert.deepEqual(events.map((e: any) => e.status), ["loading", "running", "failed"]);
});

test("no stopping report pauses instead of inventing input", () => {
  const f = fixture(); f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } });
  assert.equal(f.state().status, "Paused"); assert.deepEqual(f.state().stages, []);
});
