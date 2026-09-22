import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import type { ExtensionAPI, RegisteredCommand, ToolDefinition } from "@earendil-works/pi-coding-agent";

type ExtensionModule = Pick<typeof import("../extension.ts"), "default" | "explorerOnlyTools">;
type RegisteredTool = Pick<ToolDefinition, "name" | "promptGuidelines">;
type EventHandler = (event: { toolName?: string }) => { reason?: string } | undefined;
const { default: extension, explorerOnlyTools } = await createJiti(import.meta.url).import("../extension.ts") as ExtensionModule;

interface ExtensionMock {
  registerCommand: ExtensionAPI["registerCommand"];
  registerShortcut: ExtensionAPI["registerShortcut"];
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
}
function load(mock: ExtensionMock): void { extension(mock as ExtensionAPI); }

test("four current-session aliases, Agent Hub and isolated tools register without work", () => {
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, EventHandler>();
  const shortcuts = new Map<string, { handler: (ctx: never) => Promise<void> | void }>();
  const messages: unknown[][] = [], tools: RegisteredTool[] = [];
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: (key, shortcut) => { shortcuts.set(key, shortcut as { handler: (ctx: never) => Promise<void> | void }); },
    registerTool: tool => { tools.push(tool as unknown as RegisteredTool); },
    on: (name, handler) => { handlers.set(name, handler as unknown as EventHandler); return () => undefined; },
    sendUserMessage: (...args) => { messages.push(args); },
  });
  assert.deepEqual([...commands.keys()].sort(), ["dev-build", "dev-plan", "dev-ship", "dev-spec"]);
  assert.ok(shortcuts.has("alt+a"));
  assert.deepEqual(tools.map(tool => tool.name), ["explore", "review", "build_handoff"]);
  assert.equal(messages.length, 0);
  const explore = tools[0]; assert.ok(explore?.promptGuidelines?.join("\n").includes("one self-contained scope"));
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.match(toolCall({ toolName })?.reason ?? "", /narrowly scoped explore calls/);
  assert.equal(toolCall({ toolName: "review" }), undefined);
});
