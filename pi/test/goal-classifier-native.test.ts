import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { role } from "../lib/roles.ts";

const cases = [
  { label: "done", expected: "Completed" },
  { label: "continue", expected: "Paused" },
  { label: "blocked", expected: "Blocked" },
  { label: "unclear", expected: "Paused" },
] as const;
for (const { label, expected } of cases) test(`native ambiguous report accepts narrow assessor label ${label}`, { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-narrow-native-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [resolve(import.meta.dirname, "..") ] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings }); await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  const observed: string[] = []; let foregroundCalls = 0;
  runtime.streamSimple = (model, context) => {
    const stream = createAssistantMessageEventStream();
    const isAssessor = model.id === role("assessor").model;
    if (isAssessor) {
      assert.equal(context.messages.length, 1);
      assert.deepEqual(context.tools, []);
      const serialized = (context.messages[0]!.content[0] as { text: string }).text;
      const data = JSON.parse(serialized);
      assert.deepEqual(Object.keys(data), ["version", "report"]);
      assert.deepEqual(Object.keys(data.report), ["progress", "remaining", "blocker"]);
      observed.push(serialized);
    }
    const content: AssistantMessage["content"] = isAssessor ? [{ type: "text", text: label }] : foregroundCalls++ === 0
      ? [{ type: "toolCall", id: "report", name: "stopping_report", arguments: { progress: "Implementation checkpoint", remaining: "unknown", blocker: null } }]
      : [{ type: "text", text: "Waiting" }];
    const stopReason = content[0]?.type === "toolCall" ? "toolUse" : "stop";
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message: {
      role: "assistant", content, stopReason, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } })); return stream;
  };
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir: cwd, model: getModel("openai", "gpt-4o-mini"),
    modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: manager });
  t.after(() => session.dispose());
  await session.prompt("/dev-goal start Track checkpoint");
  await new Promise(done => setImmediate(done)); await session.waitForIdle();
  for (let n = 0; n < 20 && observed.length === 0; n++) await new Promise(done => setTimeout(done, 10));
  await new Promise(done => setTimeout(done, 20));
  const last = manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal").at(-1);
  assert.equal(last?.type === "custom" && (last.data as { status: string }).status, expected);
  assert.equal(observed.length, 1);
  if (label === "continue") assert.match(JSON.stringify(last), /Reported work remains/);
});
