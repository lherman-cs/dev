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
  { label: "COMPLETE", expected: "Waiting" }, // A contradictory completion cannot settle unfinished work.
  { label: "CONTINUE", expected: "Waiting" }, // The second foreground turn stops without a report.
  { label: "WAIT", expected: "Waiting" },
  { label: "unclear", expected: "Error" },
] as const;
for (const { label, expected } of cases) test(`native compact assessor label ${label}`, { timeout: 20000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "goal-narrow-native-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const settings = SettingsManager.inMemory({ packages: [resolve(import.meta.dirname, "..") ] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings }); await loader.reload();
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  const observed: string[] = []; let foregroundCalls = 0;
  runtime.streamSimple = (model, context) => {
    const stream = createAssistantMessageEventStream();
    const isAssessor = model.id === role("assessor").model;
    if (isAssessor) {
      assert.equal(context.messages.length, 1); assert.deepEqual(context.tools, []);
      const serialized = (context.messages[0]!.content[0] as { text: string }).text;
      assert.deepEqual(Object.keys(JSON.parse(serialized)), ["remaining", "nextAction", "dependency", "complete"]);
      observed.push(serialized);
    }
    const content: AssistantMessage["content"] = isAssessor ? [{ type: "text", text: label }] : foregroundCalls++ === 0
      ? [{ type: "toolCall", id: "report", name: "stopping_report", arguments: { remaining: "unknown", nextAction: null, dependency: { kind: "unknown", detail: "Need clarification" }, complete: false } }]
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
});
