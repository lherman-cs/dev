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

test("three current-session aliases, Agent Hub and isolated tools register without work", () => {
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
  assert.deepEqual([...commands.keys()].sort(), ["dev-build", "dev-goal", "dev-ship", "dev-spec"]);
  assert.ok(shortcuts.has("alt+a"));
  assert.deepEqual(tools.map(tool => tool.name), ["review_disposition", "goal_control", "continue_goal", "finish", "stopping_report", "verify", "explore", "review"]);
  assert.equal(messages.length, 0);
  const explore = tools.find(tool => tool.name === "explore"); assert.ok(explore);
  const toolCall = handlers.get("tool_call"); assert.ok(toolCall);
  for (const toolName of explorerOnlyTools) assert.ok(toolCall({ toolName })?.reason);
  assert.ok(toolCall({ toolName: "review" })?.reason);
  assert.equal(toolCall({ toolName: "edit" }), undefined);
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
    appendEntry: noop,
    getActiveTools: () => [...active],
    setActiveTools: tools => { active = [...tools]; },
  }, {
    hub: new WorkerHub(),
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never,
  });
  const manager = SessionManager.inMemory(process.cwd());
  const context = { cwd: process.cwd(), hasUI: false, sessionManager: manager, ui: { notify: noop, setWidget: noop } } as never;
  await commands.get("dev-ship")?.handler("Ship request", context);
  assert.ok(active.includes("review"));
  assert.equal(handlers.get("tool_call")?.({ toolName: "review" }), undefined);
  await commands.get("dev-goal")?.handler("abandon", context);
  await commands.get("dev-build")?.handler("Build request", context);
  assert.ok(!active.includes("review"));
  assert.ok(handlers.get("tool_call")?.({ toolName: "review" })?.reason);
  handlers.get("input")?.({ text: "/skill:dev-ship plan.md" });
  assert.ok(active.includes("review"));
});

test("one broad review and one repair audit are durably bounded per ship effort", async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "review-ledger-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd });
  fs.writeFileSync(path.join(cwd, "candidate.txt"), "candidate\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "initial"], { cwd });
  const candidate = candidateFingerprint(cwd), manager = SessionManager.inMemory(cwd);
  let calls = 0;
  const run = Object.assign(async (args: Parameters<RunWorker>[0]) => {
    calls++;
    args.onStarted?.(`worker-${calls}`);
    const purpose = args.metadata?.["purpose"] as "broad" | "repair-audit";
    const focus = args.metadata?.["focus"] as string[];
    const reviewedCandidate = args.metadata?.["candidate"] as string;
    const broad = purpose === "broad";
    return { purpose, verdict: broad ? "REPAIRS" : "PASS", candidate: reviewedCandidate, evidence: `verified ${reviewedCandidate}`, focus,
      coverage: focus.map(item => ({ focus: item, status: broad && item === "whole outcome" ? "finding" : "examined", evidence: "candidate.txt:1" })), summary: "covered",
      findings: broad ? [{ key: "F1", focus: "whole outcome", title: "Candidate issue", problem: "Unsettled behavior", repair_direction: "Fix behavior", evidence: ["candidate.txt:1"], acceptance_checks: ["Affected behavior verified"] }] : [], blocker: null };
  }, { hasActive: () => false, stopAll: async () => undefined, related: async () => "unused" });
  const tools: RegisteredTool[] = [], commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const noop = () => undefined;
  load({
    registerCommand: (name, command) => { commands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { tools.push(tool as RegisteredTool); },
    on: (() => noop) as ExtensionAPI["on"],
    sendMessage: noop as ExtensionAPI["sendMessage"], sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    appendEntry: (name, data) => manager.appendCustomEntry(name, data),
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  const context = { cwd, hasUI: false, sessionManager: manager, ui: { notify: noop, setWidget: noop } } as never;
  await commands.get("dev-ship")!.handler("Ship this candidate", context);
  const review = tools.find(tool => tool.name === "review")!;
  const request = { task: "Review all agreed behavior", candidate, evidence: `verified ${candidate}` };
  await assert.rejects(review.execute("bad-preflight", { ...request, evidence: "stale proof", purpose: "broad", focus: ["whole outcome"] }, undefined, undefined, context), /must identify/);
  await review.execute("broad", { ...request, purpose: "broad", focus: ["whole outcome", "identity safety"] }, undefined, undefined, context);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(review.execute("duplicate", { ...request, purpose: "broad", focus: ["whole outcome"] }, undefined, undefined, context), /already completed/);
  const disposition = tools.find(tool => tool.name === "review_disposition")!;
  await assert.rejects(disposition.execute("unknown", { key: "F2", status: "resolved", rationale: "fixed", repair: "changed", verification: "checked" }, undefined, undefined, context), /not in this effort/);
  await assert.rejects(disposition.execute("unverified", { key: "F1", status: "resolved", rationale: "fixed", repair: "changed" }, undefined, undefined, context), /require repair and verification/);
  await disposition.execute("closure", { key: "F1", status: "resolved", rationale: "Accepted and closed", repair: "candidate fix", verification: "affected validation passed" }, undefined, undefined, context);

  const restoredTools: RegisteredTool[] = [], restoredCommands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const resumedMessages: string[] = [];
  const restoredHandlers = new Map<string, Array<(event: unknown, context: unknown) => Promise<unknown> | unknown>>();
  load({
    registerCommand: (name, command) => { restoredCommands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { restoredTools.push(tool as RegisteredTool); },
    on: (name, handler) => { const list = restoredHandlers.get(name) ?? []; list.push(handler as (event: unknown, context: unknown) => unknown); restoredHandlers.set(name, list); return noop; },
    sendMessage: message => { resumedMessages.push(String(message.content)); }, sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    appendEntry: (name, data) => manager.appendCustomEntry(name, data),
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  for (const handler of restoredHandlers.get("session_start") ?? []) await handler({}, context);
  await restoredCommands.get("dev-goal")!.handler("resume", context);
  assert.ok(resumedMessages.some(message => message.includes("whole outcome") && message.includes('"verdict":"REPAIRS"') && message.includes("affected validation passed")), "recovery exposes durable receipt, dispositions and frozen focus");
  const restoredReview = restoredTools.find(tool => tool.name === "review")!;
  await assert.rejects(restoredReview.execute("restored-duplicate", { ...request, purpose: "broad", focus: ["whole outcome"] }, undefined, undefined, context), /already completed/);
  fs.writeFileSync(path.join(cwd, "candidate.txt"), "repaired candidate\n");
  const repairedCandidate = candidateFingerprint(cwd);
  const repairedRequest = { ...request, candidate: repairedCandidate, evidence: `verified ${repairedCandidate}` };
  await restoredReview.execute("audit", { ...repairedRequest, purpose: "repair-audit", focus: ["finding F1", "affected invariant"] }, undefined, undefined, context);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(restoredReview.execute("duplicate-audit", { ...repairedRequest, purpose: "repair-audit", focus: ["finding F1"] }, undefined, undefined, context), /already completed/);
  assert.equal(calls, 2);
  const state = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").at(-1);
  const reviews = state?.type === "custom" ? (state.data as { reviews: { broad: { status: string; dispositions: Record<string, { status: string }> }; repairAudit: { status: string } } }).reviews : undefined;
  assert.equal(reviews?.broad.status, "completed"); assert.equal(reviews?.broad.dispositions["F1"]?.status, "resolved"); assert.equal(reviews?.repairAudit.status, "completed");
  const forkManager = SessionManager.inMemory(cwd);
  if (state?.type !== "custom") assert.fail("Missing durable ship effort");
  forkManager.appendCustomEntry("dev-goal", state.data);
  const forkContext = { cwd, hasUI: false, sessionManager: forkManager, ui: { notify: noop, setWidget: noop } } as never;
  const forkTools: RegisteredTool[] = [], forkCommands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const forkHandlers = new Map<string, Array<(event: unknown, context: unknown) => Promise<unknown> | unknown>>();
  load({
    registerCommand: (name, command) => { forkCommands.set(name, command); },
    registerShortcut: noop as ExtensionAPI["registerShortcut"],
    registerTool: tool => { forkTools.push(tool as RegisteredTool); },
    on: (name, handler) => { const list = forkHandlers.get(name) ?? []; list.push(handler as (event: unknown, context: unknown) => unknown); forkHandlers.set(name, list); return noop; },
    sendMessage: noop as ExtensionAPI["sendMessage"], sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
    appendEntry: (name, data) => forkManager.appendCustomEntry(name, data),
    getActiveTools: () => ["read"], setActiveTools: noop as ExtensionAPI["setActiveTools"],
  }, { hub: new WorkerHub(), createWorkerRunner: (() => run) as never,
    registerWorkerHubUI: (() => ({ setContext: noop, dispose: noop })) as never });
  for (const handler of forkHandlers.get("session_start") ?? []) await handler({}, forkContext);
  const forkState = forkManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === "dev-goal").at(-1);
  assert.equal(forkState?.type === "custom" && (forkState.data as { id: string }).id, (state.data as { id: string }).id);
  await forkCommands.get("dev-goal")!.handler("resume", forkContext);
  await assert.rejects(forkTools.find(tool => tool.name === "review")!.execute("fork-duplicate", { ...repairedRequest, purpose: "broad", focus: ["whole outcome"] }, undefined, undefined, forkContext), /already completed/);
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
