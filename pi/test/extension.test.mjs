import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { default: extension, explorerOnlyTools, workflowError } = await createJiti(import.meta.url).import("../extension.ts");

test("six symmetric commands, session-wide Agent Hub and narrow Explorer register without doing work", async () => {
  const commands = new Map(), handlers = new Map(), shortcuts = new Map(), messages = [], tools = [];
  extension({
    registerCommand: (name, command) => commands.set(name, command),
    registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
    registerTool: tool => tools.push(tool),
    on: (name, handler) => handlers.set(name, handler),
    sendUserMessage: (...args) => messages.push(args),
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  for (const name of ["spec", "plan", "build", "prepare", "review", "ship"]) assert.ok(commands.has(`dev-${name}`));
  assert.ok(commands.has("dev-workers"));
  assert.ok(shortcuts.has("alt+a"), "Agent Hub must be reachable without a /dev-* controller");
  assert.ok(handlers.has("session_start"), "main-session UI context must be registered for skill-spawned Explorers");
  assert.deepEqual(tools.map(tool => tool.name), ["explore"]);
  assert.equal(messages.length, 0);
  assert.match(tools[0].promptGuidelines.join("\n"), /Give each explore call one explicit independent scope/);
  assert.match(tools[0].promptGuidelines.join("\n"), /multiple Explorers, in parallel/);
  assert.match(tools[0].promptGuidelines.join("\n"), /boundaries, sibling exclusions, and expected evidence/);
  for (const toolName of explorerOnlyTools) assert.match(handlers.get("tool_call")({ toolName }).reason, /narrowly scoped explore calls/);
  assert.equal(handlers.get("tool_call")({ toolName: "read" }), undefined);
});

test("workflow errors explain how to resume the preserved phase and target", () => {
  assert.equal(workflowError(new Error("CI unavailable"), "ship", "plans/project/spec.md"),
    "CI unavailable\n\nProgress is preserved. After resolving the issue, resume with /dev-ship plans/project/spec.md.");
});
