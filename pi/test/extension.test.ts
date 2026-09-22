import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import type { ExtensionAPI, RegisteredCommand, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWorker } from "../lib/worker.ts";
import { WorkerHub } from "../lib/worker-hub.ts";

type ExtensionModule = Pick<typeof import("../extension.ts"), "default" | "explorerOnlyTools">;
type RegisteredTool = Pick<ToolDefinition, "name" | "promptGuidelines" | "execute">;
type EventHandler = (event: { toolName?: string; text?: string }) => { reason?: string; action?: string } | undefined;
const { default: extension, explorerOnlyTools } = await createJiti(import.meta.url).import("../extension.ts") as ExtensionModule;

interface ExtensionMock {
  registerCommand: ExtensionAPI["registerCommand"];
  registerShortcut: ExtensionAPI["registerShortcut"];
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
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
    getActiveTools: () => ["read"],
    setActiveTools: () => undefined,
  });
  assert.deepEqual([...commands.keys()].sort(), ["dev-build", "dev-plan", "dev-ship", "dev-spec"]);
  assert.ok(shortcuts.has("alt+a"));
  assert.deepEqual(tools.map(tool => tool.name), ["explore", "review", "build_handoff", "ship_observe", "ship_action"]);
  assert.equal(messages.length, 0);
  const explore = tools[0]; assert.ok(explore);
  const guidance = explore.promptGuidelines?.join("\n") ?? "";
  for (const term of [
    "material time or produce substantial raw output",
    "broad repository or web research and slow or noisy targeted verification",
    "quick known-target reads and small low-output checks",
    "one self-contained scope",
    "boundaries, sibling exclusions",
    "All Explorer calls are asynchronous",
    "callers never await Explorer calls",
    "keep output bounded, state the fallback",
    "do not bypass unavailable or prohibited tools",
    "Continue useful work",
    "result is required for the next decision",
  ]) assert.ok(guidance.includes(term), term);
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.match(toolCall({ toolName })?.reason ?? "", /narrowly scoped explore calls/);
  assert.match(toolCall({ toolName: "review" })?.reason ?? "", /reserved.*dev-ship/);
});

test("review is active only for an explicit dev-ship phase", async () => {
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, EventHandler>();
  let active = ["read"];
  const noop = () => undefined;
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: noop as ExtensionAPI["registerTool"],
    on: (name, handler) => { handlers.set(name, handler as unknown as EventHandler); return noop; },
    sendMessage: noop as ExtensionAPI["sendMessage"],
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    getActiveTools: () => [...active],
    setActiveTools: tools => { active = [...tools]; },
  }, {
    hub: new WorkerHub(),
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never,
  });
  const context = { ui: { notify: noop } } as never;
  await commands.get("dev-ship")?.handler("", context);
  assert.ok(active.includes("review"));
  assert.equal(handlers.get("tool_call")?.({ toolName: "review" }), undefined);
  await commands.get("dev-build")?.handler("", context);
  assert.ok(!active.includes("review"));
  assert.match(handlers.get("tool_call")?.({ toolName: "review" })?.reason ?? "", /reserved.*dev-ship/);
  handlers.get("input")?.({ text: "/skill:dev-ship plan.md" });
  assert.ok(active.includes("review"));
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
    getActiveTools: () => ["read"],
    setActiveTools: noop as ExtensionAPI["setActiveTools"],
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
