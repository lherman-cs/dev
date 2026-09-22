import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import type { ExtensionAPI, RegisteredCommand, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWorker } from "../lib/worker.ts";
import { WorkerHub } from "../lib/worker-hub.ts";

type ExtensionModule = Pick<typeof import("../extension.ts"), "default" | "explorerOnlyTools">;
type RegisteredTool = Pick<ToolDefinition, "name" | "promptGuidelines" | "execute">;
type EventHandler = (event: { toolName?: string }) => { reason?: string } | undefined;
const { default: extension, explorerOnlyTools } = await createJiti(import.meta.url).import("../extension.ts") as ExtensionModule;

interface ExtensionMock {
  registerCommand: ExtensionAPI["registerCommand"];
  registerShortcut: ExtensionAPI["registerShortcut"];
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
}
function load(mock: ExtensionMock, dependencies?: Parameters<typeof extension>[1]): void { extension(mock as ExtensionAPI, dependencies); }

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
    sendMessage: (...args) => { messages.push(args); },
    sendUserMessage: (...args) => { messages.push(args); },
  });
  assert.deepEqual([...commands.keys()].sort(), ["dev-build", "dev-plan", "dev-ship", "dev-spec"]);
  assert.ok(shortcuts.has("alt+a"));
  assert.deepEqual(tools.map(tool => tool.name), ["explore", "review", "build_handoff", "ship_action"]);
  assert.equal(messages.length, 0);
  const explore = tools[0]; assert.ok(explore?.promptGuidelines?.join("\n").includes("one self-contained scope"));
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.match(toolCall({ toolName })?.reason ?? "", /narrowly scoped explore calls/);
  assert.equal(toolCall({ toolName: "review" }), undefined);
});

test("a completed asynchronous Explorer steers Main and triggers progress", async () => {
  let resolve!: (value: unknown) => void;
  const run = (() => new Promise(done => { resolve = done; })) as unknown as RunWorker & {
    hasActive(): boolean; stopAll(): Promise<void>; related(): Promise<string>;
  };
  run.hasActive = () => false; run.stopAll = async () => undefined; run.related = async () => "unused";
  const tools: RegisteredTool[] = [], messages: unknown[][] = [];
  const noop = () => undefined;
  load({
    registerCommand: noop as ExtensionAPI["registerCommand"],
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { tools.push(tool as unknown as RegisteredTool); },
    on: (() => noop) as ExtensionAPI["on"],
    sendMessage: (...args) => { messages.push(args); },
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
  }, {
    hub: new WorkerHub(),
    createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never,
  });
  const explore = tools.find(tool => tool.name === "explore"); assert.ok(explore);
  const receipt = await explore.execute("call", { task: "find evidence" }, undefined, undefined, { cwd: process.cwd() } as never);
  assert.match((receipt.content[0] as { text: string }).text, /Started asynchronous Explorer/);
  assert.equal(messages.length, 0);
  resolve({ status: "FOUND", answer: "evidence found", evidence: [{ claim: "entry", anchor: "src/main.ts:1" }] });
  await new Promise(done => setImmediate(done));
  assert.equal(messages.length, 1);
  const [message, options] = messages[0] as [{ customType: string; content: string; details: { status: string } }, { triggerTurn: boolean; deliverAs: string }];
  assert.equal(message.customType, "dev-worker-result"); assert.match(message.content, /evidence found/); assert.equal(message.details.status, "completed");
  assert.deepEqual(options, { triggerTurn: true, deliverAs: "steer" });
});
