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
  { git = false, questionAnswer, workerTools = false }: { git?: boolean; questionAnswer?: "Replace goal" | "Refine existing goal" | "Keep current goal" | "dismissed"; workerTools?: boolean } = {}) {
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
    tools: ["finish", "goal_control", "ask_user_question", "bash", ...(workerTools ? ["explore", "review"] : [])],
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

test("native Explorer result is a tracked dependency and wakes a guarded Main turn", { timeout: 20000 }, async t => {
  let doneWorker!: (content: Content) => void, ready!: () => void;
  const workerReady = new Promise<void>(resolve => { ready = resolve; });
  let started = false;
  const f = await fixture(t, (model, _n, context, done) => {
    if (model.id === role("explorer").model) { doneWorker = done; ready(); return undefined; }
    if (!started) { started = true; return tool("explore", { task: "Find evidence for A" }); }
    return text(context.includes("A exists") ? "Received Explorer evidence" : "Waiting for Explorer evidence");
  }, { workerTools: true, git: true });
  await f.session.prompt("/dev-build Complete A");
  await workerReady;
  assert.equal(f.history().at(-1)?.status, "Active");
  await f.session.waitForIdle();
  doneWorker(tool("submit_result", { status: "FOUND", answer: "A exists", evidence: [{ claim: "A", anchor: "a.ts:1" }] }));
  for (let i = 0; i < 100 && !f.events.some(e => e.type === "message_end" && e.message.role === "custom" &&
    e.message.customType === "dev-worker-result"); i++) await new Promise(done => setTimeout(done, 5));
  for (let i = 0; i < 100 && !f.events.some(e => e.type === "message_end" && e.message.role === "assistant" &&
    e.message.content.some(part => part.type === "text" && part.text.includes("Received Explorer evidence"))); i++) await new Promise(done => setTimeout(done, 5));
  await f.session.waitForIdle();
  assert.ok(f.events.some(e => e.type === "message_end" && e.message.role === "custom" &&
    e.message.customType === "dev-worker-result"));
  assert.ok(f.events.some(e => e.type === "message_end" && e.message.role === "assistant" &&
    e.message.content.some(part => part.type === "text" && part.text.includes("Received Explorer evidence"))));
  assert.notEqual(f.history().at(-1)?.status, "Completed");
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
