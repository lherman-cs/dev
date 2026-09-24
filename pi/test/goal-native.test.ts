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

test("spec build and review activate durable goals while ship stays goal-free", { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-native-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [pkg] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings });
  await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  runtime.streamSimple = model => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: {
      role: "assistant", content: [{ type: "text", text: "Provisional" }], stopReason: "stop",
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
  const settle = async () => { await new Promise(done => setImmediate(done)); await session.waitForIdle(); };
  const records = () => manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal")
    .map(entry => entry.type === "custom" ? entry.data as { id: string; request: string; skill?: string; status: string } : undefined).filter(Boolean);

  await session.prompt("An ordinary question"); assert.equal(records().length, 0);
  for (const phase of ["spec", "build", "review"] as const) {
    await session.prompt(`/dev-${phase} ${phase} request`); await settle();
    assert.equal(records().at(-1)?.skill, phase);
    await session.prompt("/dev-goal abandon");
  }
  const before = records().length;
  await session.prompt("/dev-ship Package reviewed candidate"); await settle();
  assert.equal(records().length, before, "ship must not activate a goal");
});

test("native explicit finish settles without an assessor call", { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-native-finish-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [pkg] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings }); await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  let submitted = false, assessorCalls = 0;
  runtime.streamSimple = model => {
    const stream = createAssistantMessageEventStream();
    if (model.id === role("assessor").model) assessorCalls++;
    const finish = !submitted;
    if (finish) submitted = true;
    const content = finish ? [{ type: "toolCall" as const, id: "proposal", name: "finish", arguments: { outcome: "complete", summary: "Done", evidence: "Foreground declares done" } }] : [{ type: "text" as const, text: "Done" }];
    const stopReason = finish ? "toolUse" : "stop";
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: {
      role: "assistant", content, stopReason, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } })); return stream;
  };
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir: cwd, model: getModel("openai", "gpt-4o-mini"),
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: manager, tools: ["finish", "goal_control"] });
  t.after(() => session.dispose());
  await session.prompt("/dev-goal start Complete local goal");
  await new Promise(done => setImmediate(done)); await session.waitForIdle();
  assert.equal(assessorCalls, 0);
  const state = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").at(-1);
  assert.equal(state?.type === "custom" && (state.data as { status: string }).status, "Completed");
});
