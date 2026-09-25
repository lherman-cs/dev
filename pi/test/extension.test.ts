import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";
import { SessionManager, type ExtensionAPI, type RegisteredCommand, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWorker } from "../lib/worker.ts";
import { WorkerHub } from "../lib/worker-hub.ts";
import { candidateFingerprint } from "../lib/verifier.ts";

type ExtensionModule = Pick<typeof import("../extension.ts"), "default" | "explorerOnlyTools">;
type RegisteredTool = Pick<ToolDefinition, "name" | "execute">;
type EventHandler = (event: { toolName?: string; text?: string }) => { reason?: string; action?: string } | undefined;
const { default: extension, explorerOnlyTools } = await createJiti(import.meta.url).import("../extension.ts") as ExtensionModule;

interface ExtensionMock {
  registerCommand: ExtensionAPI["registerCommand"];
  registerShortcut: ExtensionAPI["registerShortcut"];
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  appendEntry?: ExtensionAPI["appendEntry"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
}
function load(mock: ExtensionMock, dependencies?: Parameters<typeof extension>[1]): void { extension(mock as ExtensionAPI, dependencies); }

test("four current-session aliases and supporting tools register without work", () => {
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
  assert.deepEqual([...commands.keys()].sort(), ["dev-brief", "dev-build", "dev-goal", "dev-review", "dev-ship", "dev-spec"]);
  assert.ok(shortcuts.has("alt+a"));
  assert.ok(tools.some(tool => tool.name === "verify"));
  assert.ok(tools.some(tool => tool.name === "explore"));
  assert.ok(!tools.some(tool => tool.name === "review"), "review is a foreground phase, not a child tool");
  assert.equal(messages.length, 0);
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.ok(toolCall({ toolName })?.reason);
  assert.equal(toolCall({ toolName: "edit" }), undefined);
});

test("spec build and review activate goals while ship delegates to the deterministic packager", async () => {
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const noop = () => undefined, manager = SessionManager.inMemory(process.cwd());
  let packaged = 0;
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: noop as ExtensionAPI["registerTool"],
    on: (() => noop) as ExtensionAPI["on"],
    sendMessage: noop as ExtensionAPI["sendMessage"],
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    appendEntry: (name, data) => manager.appendCustomEntry(name, data),
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never,
    packageReviewedCandidate: (async () => { packaged++; return "packaged"; }) as never });
  const context = { cwd: process.cwd(), hasUI: false, sessionManager: manager, ui: { notify: noop, setWidget: noop } } as never;
  for (const phase of ["spec", "brief", "build"] as const) {
    await commands.get(`dev-${phase}`)!.handler(`${phase} request`, context);
    const goals = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal");
    assert.equal((goals.at(-1) as { data: { skill?: string } }).data.skill, phase);
    await commands.get("dev-goal")!.handler("abandon", context);
  }
  await commands.get("dev-review")!.handler("review request", context);
  let goals = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal");
  assert.equal((goals.at(-1) as { data: { skill?: string } }).data.skill, "review");
  const sentBeforeBlockedShip = goals.length;
  await commands.get("dev-ship")!.handler("ship request", context);
  assert.equal(manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").length, sentBeforeBlockedShip);
  await commands.get("dev-goal")!.handler("abandon", context);
  const before = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").length;
  await commands.get("dev-ship")!.handler("ship request", context);
  const after = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").length;
  assert.equal(after, before, "ship must not activate a goal");
  assert.equal(packaged, 1);
});

test("session change cancels active evidence work without vetoing or transferring ownership", async () => {
  let stops = 0;
  const run = Object.assign(async () => "unused", {
    hasActive: () => true, stopAll: async () => { stops++; await new Promise(() => undefined); }, related: async () => "unused",
  });
  const handlers = new Map<string, (event?: unknown) => Promise<unknown> | unknown>();
  const noop = () => undefined;
  load({
    registerCommand: noop as ExtensionAPI["registerCommand"],
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: noop as ExtensionAPI["registerTool"],
    on: (name, handler) => { handlers.set(name, handler as (event?: unknown) => unknown); return noop; },
    sendMessage: noop as ExtensionAPI["sendMessage"],
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    getActiveTools: () => ["read"],
    setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  assert.equal(await handlers.get("session_before_switch")?.(), undefined);
  assert.equal(await handlers.get("session_before_fork")?.(), undefined);
  assert.equal(stops, 2);
  assert.equal(handlers.get("tool_call")?.({ toolName: "edit" }), undefined);
});

test("late completion from an earlier session cannot steer the new owner", async () => {
  let resolve!: (value: unknown) => void;
  const run = Object.assign(() => new Promise(done => { resolve = done; }), {
    hasActive: () => true, stopAll: async () => undefined, related: async () => "unused",
  });
  const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown> | unknown>();
  const tools: RegisteredTool[] = [], messages: unknown[] = [];
  const noop = () => undefined;
  load({
    registerCommand: noop as ExtensionAPI["registerCommand"],
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { tools.push(tool as RegisteredTool); },
    on: (name, handler) => { handlers.set(name, handler as (event: unknown, ctx?: unknown) => unknown); return noop; },
    sendMessage: (...args) => { messages.push(args); },
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    getActiveTools: () => ["read"],
    setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  const context = (sessionManager: SessionManager) => ({ sessionManager, ui: { notify: noop } });
  await handlers.get("session_start")?.({}, context(SessionManager.inMemory(process.cwd())));
  const explore = tools.find(tool => tool.name === "explore"); assert.ok(explore);
  await explore.execute("call", { task: "earlier evidence" }, undefined, undefined, { cwd: process.cwd() } as never);
  await handlers.get("session_start")?.({}, context(SessionManager.inMemory(process.cwd())));
  resolve({ status: "FOUND", answer: "stale", evidence: [{ claim: "old", anchor: "README.md:1" }] });
  await new Promise(done => setImmediate(done));
  assert.equal(messages.length, 0);
});

test("failed Explorer delivery pauses the active goal instead of silently settling", async () => {
  let resolve!: (value: unknown) => void;
  const run = Object.assign(() => new Promise(done => { resolve = done; }), {
    hasActive: () => false, stopAll: async () => undefined, related: async () => "unused",
  });
  const tools: RegisteredTool[] = [], commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
  const noop = () => undefined;
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { tools.push(tool as RegisteredTool); },
    on: (name, handler) => { handlers.set(name, handler as (event: unknown, context: unknown) => unknown); return noop; },
    sendMessage: () => { throw new Error("queue unavailable"); },
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    appendEntry: (name, data) => manager.appendCustomEntry(name, data),
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  const manager = SessionManager.inMemory(process.cwd());
  const context = { cwd: process.cwd(), sessionManager: manager, hasUI: false, ui: { notify: noop, setWidget: noop } } as never;
  await commands.get("dev-build")!.handler("Complete A", context);
  const explore = tools.find(t => t.name === "explore")!;
  await explore.execute("call", { task: "find A" }, undefined, undefined, context);
  assert.equal(handlers.get("agent_before_settle")?.({ outcome: "completed", context: { canContinue: true } }, context), undefined);
  resolve({ status: "FOUND", answer: "A", evidence: [{ claim: "A", anchor: "a.ts:1" }] });
  await new Promise(done => setImmediate(done));
  const goals = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal");
  assert.equal((goals.at(-1) as { data: { status: string; reason: string } }).data.status, "Paused");
  assert.match((goals.at(-1) as { data: { status: string; reason: string } }).data.reason, /delivery failed/);
});

test("Verifier delivers actual execution evidence through the Main session lifecycle", async () => {
  const tools: RegisteredTool[] = [], messages: unknown[][] = [];
  const noop = () => undefined;
  load({
    registerCommand: noop as ExtensionAPI["registerCommand"],
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { tools.push(tool as unknown as RegisteredTool); },
    on: (() => noop) as ExtensionAPI["on"],
    sendMessage: (...args) => { messages.push(args); },
    sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  const verify = tools.find(tool => tool.name === "verify"); assert.ok(verify);
  const delivered = new Promise<void>(resolve => {
    const send = messages.push.bind(messages);
    messages.push = (...args) => { const result = send(...args); resolve(); return result; };
  });
  const receipt = await verify.execute("call", { commands: ["node -e 'console.log(\"verified\")'"] }, undefined, undefined, { cwd: process.cwd() } as never);
  assert.match((receipt.content[0] as { text: string }).text, /started/);
  assert.equal(messages.length, 0);
  await delivered;
  const [message, options] = messages[0] as [{ content: string; details: { role: string; status: string } }, { triggerTurn: boolean; deliverAs: string }];
  assert.equal(message.details.role, "Verifier");
  assert.equal(message.details.status, "completed");
  assert.match(message.content, /verified|passed/);
  assert.deepEqual(options, { triggerTurn: true, deliverAs: "steer" });
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
  assert.match((receipt.content[0] as { text: string }).text, /Explorer .* started/);
  assert.equal(messages.length, 0);
  resolve({ status: "FOUND", answer: "evidence found", evidence: [{ claim: "entry", anchor: "src/main.ts:1" }] });
  await new Promise(done => setImmediate(done));
  assert.equal(messages.length, 1);
  const [message, options] = messages[0] as [{ customType: string; content: string; details: { status: string; task: string } }, { triggerTurn: boolean; deliverAs: string }];
  assert.equal(message.customType, "dev-worker-result"); assert.match(message.content, /evidence found/); assert.equal(message.details.status, "completed");
  assert.ok(!message.content.includes("find evidence"), "model-facing steer should omit the redundant task");
  assert.equal(message.details.task, "find evidence", "full task stays available as non-steering metadata");
  assert.deepEqual(options, { triggerTurn: true, deliverAs: "steer" });
});
