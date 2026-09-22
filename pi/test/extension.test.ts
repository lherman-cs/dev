import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import type { ExtensionAPI, RegisteredCommand, ToolDefinition } from "@earendil-works/pi-coding-agent";

type ExtensionModule = Pick<typeof import("../extension.ts"), "default" | "explorerOnlyTools" | "workflowError">;
type RegisteredTool = Pick<ToolDefinition, "name" | "promptGuidelines">;
type EventHandler = (event: { toolName?: string }) => { reason?: string } | undefined;
const { default: extension, explorerOnlyTools, workflowError } = await createJiti(import.meta.url).import("../extension.ts") as ExtensionModule;

/** A deliberately narrow, typed adapter for the ExtensionAPI surface used here. */
interface ExtensionMock {
  registerCommand: ExtensionAPI["registerCommand"];
  registerShortcut: ExtensionAPI["registerShortcut"];
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  exec: ExtensionAPI["exec"];
}

function load(mock: ExtensionMock): void {
  extension(mock as ExtensionAPI);
}

test("six symmetric commands, session-wide Agent Hub and narrow Explorer register without doing work", async () => {
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, EventHandler>();
  const shortcuts = new Map<string, { handler: (ctx: never) => Promise<void> | void }>();
  const messages: unknown[][] = [];
  const tools: RegisteredTool[] = [];
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: (key, shortcut) => { shortcuts.set(key, shortcut as { handler: (ctx: never) => Promise<void> | void }); },
    registerTool: tool => { tools.push(tool as unknown as RegisteredTool); },
    on: (name, handler) => { handlers.set(name, handler as unknown as EventHandler); return () => undefined; },
    sendUserMessage: (...args) => { messages.push(args); },
    exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
  });
  for (const name of ["spec", "plan", "build", "prepare", "review", "ship"]) assert.ok(commands.has(`dev-${name}`));
  assert.ok(commands.has("dev-workers"));
  assert.ok(shortcuts.has("alt+a"), "Agent Hub must be reachable without a /dev-* controller");
  assert.ok(handlers.has("session_start"), "main-session UI context must be registered for skill-spawned Explorers");
  assert.deepEqual(tools.map(tool => tool.name), ["explore"]);
  assert.equal(messages.length, 0);
  const explore = tools[0]; assert.ok(explore);
  const guidelines=explore.promptGuidelines; assert.ok(guidelines);
  assert.match(guidelines.join("\n"), /Give each explore call one self-contained scope/);
  assert.match(guidelines.join("\n"), /separate calls for independent scopes/);
  assert.match(guidelines.join("\n"), /boundaries, sibling exclusions, and expected evidence/);
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.match(toolCall({ toolName })?.reason ?? "", /narrowly scoped explore calls/);
  assert.equal(toolCall({ toolName: "read" }), undefined);
});

test("workflow errors explain how to resume the preserved phase and target", () => {
  assert.equal(workflowError(new Error("CI unavailable"), "ship", "plans/project/spec.md"),
    "CI unavailable\n\nProgress is preserved. After resolving the issue, resume with /dev-ship plans/project/spec.md.");
});
