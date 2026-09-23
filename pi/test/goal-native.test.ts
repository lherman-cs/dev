import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { role } from "../lib/roles.ts";

const pkg = resolve(import.meta.dirname, "..");

test("native command and skill entry paths activate once; plain chat and spec do not", { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-native-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [pkg] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings });
  await loader.reload();
  const runtime = await ModelRuntime.create();
  runtime.hasConfiguredAuth = () => true;
  let turns = 0;
  runtime.streamSimple = model => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: {
      role: "assistant", content: [{ type: "text", text: `Provisional ${++turns}` }], stopReason: "stop",
      provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }));
    return stream;
  };
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir: cwd, model: getModel("openai", "gpt-4o-mini"),
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  t.after(() => session.dispose());
  const records = () => manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal")
    .map(entry => entry.type === "custom" ? entry.data as { id: string; request: string; skill?: string; status: string } : undefined).filter(Boolean);

  await session.prompt("An ordinary question");
  assert.equal(records().length, 0);
  await session.prompt("/skill:dev-spec Example spec");
  assert.equal(records().length, 0);
  await session.prompt("/dev-build Implement case A");
  await new Promise(done => setImmediate(done));
  await session.waitForIdle();
  assert.ok(records().length > 0);
  const first = records()[0]!;
  assert.equal(first.request, "Implement case A");
  assert.equal(first.skill, "build");
  assert.equal(records().filter(entry => entry?.id !== first.id).length, 0);
  assert.equal(records().at(-1)?.status, "Paused"); // Repeated unsupported finals cannot settle.

  await session.prompt("/dev-goal abandon");
  await session.prompt("/dev-goal start Standalone goal B");
  await new Promise(done => setImmediate(done));
  await session.waitForIdle();
  assert.equal(records().at(-1)?.request, "Standalone goal B");
  assert.equal(records().at(-1)?.skill, undefined);
  assert.notEqual(records().at(-1)?.id, first.id);
  await session.prompt("/dev-goal abandon");
  await session.prompt("/skill:dev-ship Ship case C");
  await session.waitForIdle();
  assert.equal(records().at(-1)?.request, "Ship case C");
  assert.equal(records().at(-1)?.skill, "ship");
});

test("native finish starts a fresh assessor and only its structured verdict can settle completion", { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-verified-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [pkg] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings });
  await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  const createRuntime = ModelRuntime.create;
  ModelRuntime.create = async () => runtime;
  t.after(() => { ModelRuntime.create = createRuntime; });
  let proposed = false, assessed = 0;
  runtime.streamSimple = model => {
    const stream = createAssistantMessageEventStream();
    const assessor = model.id === role("assessor").model;
    const finish = !assessor && !proposed;
    const submitting = assessor && assessed++ === 0;
    if (finish) proposed = true;
    const content = submitting
      ? [{ type: "toolCall" as const, id: "verdict", name: "submit_result", arguments: { verdict: "complete", explanation: "Independent proof verified", missing: [] } }]
      : finish ? [{ type: "toolCall" as const, id: "proposal", name: "finish", arguments: { outcome: "complete", summary: "Done", evidence: "Verified local state" } }]
      : [{ type: "text" as const, text: "Waiting for verification" }];
    const stopReason = submitting || finish ? "toolUse" : "stop";
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: {
      role: "assistant", content, stopReason, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } }));
    return stream;
  };
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir: cwd, model: getModel("openai", "gpt-4o-mini"),
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: manager, tools: ["finish", "goal_control"] });
  t.after(() => session.dispose());
  assert.ok(session.getActiveToolNames().includes("finish"));
  const records = () => manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal")
    .map(entry => entry.type === "custom" ? entry.data as { status: string } : undefined);
  let timer: ReturnType<typeof setTimeout>;
  const completed = new Promise<void>((done, fail) => {
    timer = setTimeout(() => fail(new Error(`No independently settled result: proposed=${proposed}, assessed=${assessed}, state=${JSON.stringify(records().at(-1))}`)), 8000);
    session.subscribe(event => {
      if (event.type === "agent_settled" && records().at(-1)?.status === "Completed") { clearTimeout(timer); done(); }
    });
  });
  await session.prompt("/dev-goal start Complete local goal");
  await completed;
  assert.equal(assessed, 2);
  assert.ok(proposed);
  assert.ok(manager.getBranch().some(entry => entry.type === "custom" && entry.customType === "dev-goal" && (entry.data as { status: string }).status === "Checking completion"));
  assert.equal(records().at(-1)?.status, "Completed");
});
