import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAssistantMessageEventStream, Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createAgentSession, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import { role } from "../lib/roles.ts";

const pkg = resolve(import.meta.dirname, "..");
type Content = AssistantMessage["content"];
type Model = Parameters<ModelRuntime["streamSimple"]>[0];
const message = (model: Model, content: Content, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant", content, stopReason, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const text = (value: string): Content => [{ type: "text", text: value }];
const tool = (name: string, args: Record<string, unknown>): Content => [{ type: "toolCall", id: `${name}-${Math.random()}`, name, arguments: args as Extract<Content[number], { type: "toolCall" }>["arguments"] }];
const tick = () => new Promise<void>(done => setImmediate(done));
const askIntent = () => tool("ask_user_question", { questions: [{ question: "Does the new build request replace or refine the unfinished goal?", header: "Goal intent",
  options: [
    { label: "Replace goal", description: "Abandon the unfinished request and start the new one." },
    { label: "Refine existing goal", description: "Keep the original scope and add the new request." },
    { label: "Keep current goal", description: "Dismiss the new request and keep the original." },
  ] }] });

async function fixture(t: TestContext, answer: (model: Model, call: number, context: string, done: (content: Content) => void) => Content | undefined,
  { git = false, questionAnswer }: { git?: boolean; questionAnswer?: "Replace goal" | "Refine existing goal" | "Keep current goal" | "dismissed" } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "goal-sequence-"));
  if (git) {
    execFileSync("git", ["init", "-q", cwd]);
    execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "--allow-empty", "-qm", "base"]);
  }
  const settings = SettingsManager.inMemory({ packages: [pkg], compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 } });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings });
  await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  const originalCreate = ModelRuntime.create;
  ModelRuntime.create = async () => runtime;
  let calls = 0;
  runtime.streamSimple = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const done = (content: Content) => {
      const reason = content.some(c => c.type === "toolCall") ? "toolUse" : "stop";
      stream.push({ type: "done", reason, message: message(model, content, reason) });
    };
    options?.signal?.addEventListener("abort", () => stream.push({ type: "error", reason: "aborted",
      error: { ...message(model, [], "aborted"), errorMessage: "Turn interrupted" } }), { once: true });
    const content = answer(model, ++calls, JSON.stringify(context.messages), done);
    if (content) queueMicrotask(() => done(content));
    return stream;
  };
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir: cwd, model: getModel("openai", "gpt-4o-mini"),
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: manager,
    tools: ["finish", "goal_control", "ask_user_question", "bash"],
    ...(questionAnswer ? { customTools: [{ name: "ask_user_question", label: "Question fixture", description: "Deterministic human choice",
      parameters: Type.Object({ questions: Type.Array(Type.Any()) }),
      execute: async (_id: string, args: { questions: { question: string }[] }) => ({
        content: [{ type: "text" as const, text: questionAnswer }],
        details: questionAnswer === "dismissed" ? { cancelled: true, answers: [] } :
          { cancelled: false, answers: [{ questionIndex: 0, question: args.questions[0]?.question ?? "", kind: "option", answer: questionAnswer }] },
      }),
    }] } : {}) });
  await session.bindExtensions({});
  t.after(async () => { await session.waitForIdle(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); await tick(); ModelRuntime.create = originalCreate; rmSync(cwd, { recursive: true, force: true }); });
  const events: AgentSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  const history = () => manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal")
    .map(e => e.type === "custom" ? e.data as { id: string; request: string; status: string; reason: string; clarifications: string[]; assessment?: string } : undefined).filter(e => e !== undefined);
  return { cwd, session, manager, events, history, calls: () => calls };
}

test("native ambiguous build refinement invokes question and dismissal preserves paused obligation", { timeout: 20000 }, async t => {
  let questions = 0;
  const f = await fixture(t, (_model, _n, context) => {
    if (questions === 0 && context.includes("Goal intent")) {
      questions++;
      return askIntent();
    }
    return text("Waiting for instruction");
  });
  assert.ok(f.session.getActiveToolNames().includes("ask_user_question"));
  await f.session.prompt("/dev-build Implement original");
  await f.session.waitForIdle();
  const id = f.history().at(-1)!.id;
  await f.session.prompt("/dev-build also add tests");
  await f.session.waitForIdle();
  assert.ok(questions >= 1);
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Paused");
  assert.deepEqual(f.history().at(-1)?.clarifications, []);
  assert.match(f.history().at(-1)!.reason, /dismissed|awaiting human choice/i);
  assert.ok(f.manager.getBranch().some(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "ask_user_question"));
});

test("native answer explicitly authorizes replacement and preserves the old goal in history", { timeout: 20000 }, async t => {
  let asked = false;
  const f = await fixture(t, (_model, _n, context) => {
    if (!asked && context.includes("Goal intent")) { asked = true; return askIntent(); }
    return text("Waiting for instruction");
  }, { questionAnswer: "Replace goal" });
  await f.session.prompt("/dev-build Implement original");
  await tick(); await f.session.waitForIdle();
  const id = f.history()[0]!.id;
  f.session.setActiveToolsByName([...f.session.getActiveToolNames(), 'ask_user_question']);
  assert.ok(f.session.getActiveToolNames().includes('ask_user_question'), JSON.stringify(f.session.getActiveToolNames()));
  await f.session.prompt("/dev-build Implement replacement");
  await tick(); await f.session.waitForIdle();
  assert.ok(asked);
  assert.ok(f.history().some(e => e.id === id && e.status === "Abandoned"));
  assert.equal(f.history().at(-1)?.request, "Implement replacement");
  assert.notEqual(f.history().at(-1)?.id, id);
});

test("native dismissed ambiguity retains old paused goal; refinement keeps its identity", { timeout: 20000 }, async t => {
  for (const decision of ["dismissed", "Refine existing goal"] as const) {
    let asked = false;
    const f = await fixture(t, (_model, _n, context) => {
      if (!asked && context.includes("Goal intent")) { asked = true; return askIntent(); }
      return text("Awaiting instruction");
    }, { questionAnswer: decision });
    await f.session.prompt("/dev-build Implement original");
    await tick(); await f.session.waitForIdle();
    const id = f.history().at(-1)!.id;
    f.session.setActiveToolsByName([...f.session.getActiveToolNames(), "ask_user_question"]);
    await f.session.prompt("/dev-build also add tests");
    await tick(); await f.session.waitForIdle();
    assert.ok(asked);
    assert.equal(f.history().at(-1)?.id, id);
    assert.equal(f.history().at(-1)?.request, "Implement original");
    if (decision === "dismissed") {
      assert.equal(f.history().at(-1)?.status, "Paused");
      assert.deepEqual(f.history().at(-1)?.clarifications, []);
    } else assert.ok(f.history().at(-1)?.clarifications.includes("also add tests"));
  }
});

test("native side question and quoted cancellation preserve scope; direct resume and abandon control it", { timeout: 20000 }, async t => {
  let intent: "none" | "resume" | "abandon" = "none";
  let submitted = false;
  const f = await fixture(t, () => {
    if (intent !== "none" && !submitted) { submitted = true; return tool("goal_control", { action: intent }); }
    return text("Answering the conversation without altering the obligation");
  });
  await f.session.prompt("/dev-goal start Implement feature A");
  await tick(); await f.session.waitForIdle();
  const id = f.history()[0]!.id;
  await f.session.prompt('What does the quoted word "forget" mean?');
  await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.id, id);
  assert.deepEqual(f.history().at(-1)?.clarifications, []);
  assert.equal(f.history().at(-1)?.status, "Paused");
  intent = "resume"; submitted = false;
  await f.session.prompt("Please continue the original goal");
  await f.session.waitForIdle();
  assert.ok(f.history().some(e => e.id === id && e.status === "Active" && /Reconcile/.test(e.reason)));
  intent = "abandon"; submitted = false;
  await f.session.prompt("Forget the original goal; stop working on it");
  await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Abandoned");
});

test("native late assessor cannot certify after pause and resume in the same session", { timeout: 20000 }, async t => {
  let assessorDone!: (content: Content) => void;
  let proposed = false;
  let ready!: () => void;
  const assessorReady = new Promise<void>(done => { ready = done; });
  const f = await fixture(t, (model, _call, _context, done) => {
    if (model.id === role("assessor").model) { assessorDone = done; ready(); return undefined; }
    if (!proposed) { proposed = true; return tool("finish", { outcome: "complete", summary: "Complete", evidence: "local proof" }); }
    return text("Awaiting verification");
  });
  await f.session.prompt("/dev-goal start Validate A");
  await assessorReady;
  await f.session.prompt("/dev-goal pause");
  assert.equal(f.history().at(-1)?.status, "Paused");
  await f.session.prompt("/dev-goal resume");
  await tick(); await f.session.waitForIdle();
  assessorDone(tool("submit_result", { verdict: "complete", explanation: "Stale approval", missing: [] }));
  await tick(); await f.session.waitForIdle();
  assert.notEqual(f.history().at(-1)?.status, "Completed");
  assert.ok(!f.history().some(e => e.status === "Completed"));
});

test("native navigation and reload invalidate an in-flight assessment", { timeout: 20000 }, async t => {
  let ready!: () => void, assessorDone!: (content: Content) => void;
  const assessorReady = new Promise<void>(done => { ready = done; });
  let propose = false, proposed = false;
  const f = await fixture(t, (model, _n, _context, done) => {
    if (model.id === role("assessor").model) { assessorDone = done; ready(); return undefined; }
    if (propose && !proposed) { proposed = true; return tool("finish", { outcome: "complete", summary: "Ready", evidence: "checked" }); }
    return text("Partial milestone");
  });
  await f.session.prompt("/dev-build First requirement");
  await tick(); await f.session.waitForIdle();
  const initial = f.manager.getBranch().find(e => e.type === "custom" && e.customType === "dev-goal");
  assert.ok(initial);
  const id = f.history().at(-1)!.id;
  propose = true;
  await f.session.prompt("/dev-goal resume");
  await assessorReady;
  await f.session.waitForIdle();
  assert.equal((await f.session.navigateTree(initial.id)).cancelled, false);
  assessorDone(tool("submit_result", { verdict: "complete", explanation: "Stale approval", missing: [] }));
  await tick(); await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Paused");
  await f.session.reload();
  await tick();
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Paused");
  assert.ok(!f.history().some(e => e.status === "Completed"));
});

test("native tree navigation and reload restore only paused branch identity", { timeout: 20000 }, async t => {
  const f = await fixture(t, () => text("Partial milestone"));
  await f.session.prompt("/dev-build First requirement");
  await tick(); await f.session.waitForIdle();
  const initial = f.manager.getBranch().find(e => e.type === "custom" && e.customType === "dev-goal");
  assert.ok(initial);
  const id = f.history().at(-1)!.id;
  await f.session.prompt("/dev-goal resume");
  await tick(); await f.session.waitForIdle();
  const result = await f.session.navigateTree(initial.id);
  assert.equal(result.cancelled, false);
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Paused");
  await f.session.reload();
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Paused");
});

test("native runtime fork isolates the paused identity and switch restores the original", { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-runtime-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [pkg] });
  const modelRuntime = await ModelRuntime.create(); modelRuntime.hasConfiguredAuth = () => true;
  const originalCreate = ModelRuntime.create;
  ModelRuntime.create = async () => modelRuntime;
  let propose = false, proposed = false, assessorDone!: (content: Content) => void, ready!: () => void;
  const assessorReady = new Promise<void>(done => { ready = done; });
  modelRuntime.streamSimple = model => {
    const stream = createAssistantMessageEventStream();
    const deliver = (content: Content) => {
      const reason = content.some(c => c.type === "toolCall") ? "toolUse" : "stop";
      stream.push({ type: "done", reason, message: message(model, content, reason) });
    };
    if (model.id === role("assessor").model) { assessorDone = deliver; ready(); }
    else queueMicrotask(() => deliver(propose && !proposed ? (proposed = true, tool("finish", {
      outcome: "complete", summary: "Ready", evidence: "checked" })) : text("Partial")));
    return stream;
  };
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd: target, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd: target, agentDir, settingsManager: settings, modelRuntime });
    const result = await createAgentSessionFromServices({ services, sessionManager, ...(sessionStartEvent ? { sessionStartEvent } : {}),
      model: getModel("openai", "gpt-4o-mini"), tools: ["finish", "goal_control"] });
    await result.session.bindExtensions({});
    return { ...result, services, diagnostics: services.diagnostics };
  };
  const sdk = await createAgentSessionRuntime(factory, { cwd, agentDir: cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
  t.after(async () => { await sdk.dispose(); ModelRuntime.create = originalCreate; });
  await sdk.session.prompt("/dev-build Implement original");
  await tick(); await sdk.session.waitForIdle();
  await sdk.session.prompt("Is this done yet?");
  await sdk.session.waitForIdle();
  const original = sdk.session.sessionManager;
  const record = () => sdk.session.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal")
    .map(e => e.type === "custom" ? e.data as { id: string; status: string } : undefined).at(-1);
  const originalId = record()!.id;
  const path = original.getSessionFile();
  assert.ok(path);
  const question = original.getBranch().reverse().find(e => e.type === "message" && e.message.role === "user");
  assert.ok(question);
  propose = true;
  await sdk.session.prompt("/dev-goal resume");
  await assessorReady;
  await sdk.session.waitForIdle();
  assert.equal((await sdk.fork(question.id)).cancelled, false);
  assessorDone(tool("submit_result", { verdict: "complete", explanation: "Stale fork approval", missing: [] }));
  await tick(); await sdk.session.waitForIdle();
  assert.equal(record()?.status, "Paused");
  assert.notEqual(record()?.id, originalId);
  assert.equal((await sdk.switchSession(path)).cancelled, false);
  await tick(); await sdk.session.waitForIdle();
  assert.equal(record()?.id, originalId);
  assert.equal(record()?.status, "Paused");
});

test("native interruption, compaction, partial commit, missing assessment, and final acceptance", { timeout: 20000 }, async t => {
  let finish = false, proposed = false, assessed = false, interrupt = false, interrupted = false;
  let ready!: () => void;
  const interruptionReady = new Promise<void>(done => { ready = done; });
  const f = await fixture(t, (model, _call, context) => {
    if (model.id === role("assessor").model) {
      if (context.includes("Result recorded.")) return text("Assessment submitted");
      if (!assessed) { assessed = true; return tool("submit_result", { verdict: "missing", explanation: "Second case remains", missing: ["Implement case B"] }); }
      return tool("submit_result", { verdict: "complete", explanation: "Both cases committed and checked", missing: [] });
    }
    if (finish && !proposed) { proposed = true; return tool("finish", { outcome: "complete", summary: "Case A committed", evidence: "case A" }); }
    if (interrupt && !interrupted) { interrupted = true; ready(); return undefined; }
    return text("Partial milestone only");
  }, { git: true });
  await f.session.prompt("/dev-build Implement case A and case B");
  await tick(); await f.session.waitForIdle();
  const id = f.history()[0]!.id;
  interrupt = true;
  await f.session.prompt("/dev-goal resume");
  await interruptionReady;
  await f.session.abort();
  await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.status, "Paused");
  assert.match(f.history().at(-1)!.reason, /interrupt|abort/i);
  await f.session.compact();
  assert.ok(f.events.some(e => e.type === "compaction_end"));
  assert.equal(f.history().at(-1)?.id, id);
  writeFileSync(join(f.cwd, "case-a.txt"), "case A");
  execFileSync("git", ["-C", f.cwd, "add", "case-a.txt"]);
  execFileSync("git", ["-C", f.cwd, "-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "-qm", "partial: case A"]);
  finish = true;
  const settled = new Promise<void>((done, fail) => {
    const timeout = setTimeout(() => fail(new Error(`No assessment delivery: ${JSON.stringify(f.history().at(-1))}`)), 8000);
    f.session.subscribe(e => {
      if (e.type === "agent_settled" && f.history().at(-1)?.assessment?.includes("Second case remains")) { clearTimeout(timeout); done(); }
    });
  });
  await f.session.prompt("/dev-goal resume");
  await settled;
  await tick(); await f.session.waitForIdle();
  await tick(); await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.id, id);
  assert.notEqual(f.history().at(-1)?.status, "Completed");
  assert.match(f.history().at(-1)?.assessment ?? "", /Second case remains/);
  assert.ok(f.history().some(e => e.status === "Checking completion"));
  writeFileSync(join(f.cwd, "case-b.txt"), "case B");
  execFileSync("git", ["-C", f.cwd, "add", "case-b.txt"]);
  execFileSync("git", ["-C", f.cwd, "-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "-qm", "final: case B"]);
  proposed = false;
  const final = new Promise<void>((done, fail) => {
    const timeout = setTimeout(() => fail(new Error(`No final acceptance: ${JSON.stringify(f.history().at(-1))}`)), 8000);
    f.session.subscribe(e => {
      if (e.type === "agent_settled" && f.history().at(-1)?.status === "Completed") { clearTimeout(timeout); done(); }
    });
  });
  await f.session.prompt("/dev-goal resume");
  await final;
  await f.session.waitForIdle();
  assert.equal(f.history().at(-1)?.id, id);
  assert.equal(f.history().at(-1)?.status, "Completed");
  assert.match(f.history().at(-1)?.assessment ?? "", /Both cases committed/);
});
