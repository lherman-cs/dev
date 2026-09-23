import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCompletionGuard } from "../lib/completion-guard.ts";
import type { RunWorker } from "../lib/worker.ts";

function fixture(hasAsyncWork = () => false) {
  const manager = SessionManager.inMemory(process.cwd());
  const context = { cwd: process.cwd(), sessionManager: manager, ui: { notify: () => undefined } } as unknown as ExtensionContext;
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const tools: ToolDefinition[] = [], messages: string[] = [], assessments: string[] = [];
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const run = ((args: { task: string }) => { assessments.push(args.task); return new Promise<unknown>((done, fail) => { resolve = done; reject = fail; }); }) as RunWorker;
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => {
      handlers.set(name, [...(handlers.get(name) || []), handler]); return () => undefined;
    },
    registerTool: (tool: ToolDefinition) => { tools.push(tool); },
    appendEntry: (name: string, data: unknown) => { manager.appendCustomEntry(name, data); },
    sendMessage: (message: { content: string }) => { messages.push(message.content); },
  } as unknown as ExtensionAPI;
  const guard = registerCompletionGuard(pi, run, hasAsyncWork);
  const emit = (name: string, event: any = {}, ctx = context) => handlers.get(name)?.map(fn => fn(event, ctx));
  const finish = tools.find(t => t.name === "finish")!;
  const settle = () => emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } })?.[0];
  return { guard, emit, finish, settle, context, manager, messages, assessments,
    resolve: (verdict: unknown) => resolve(verdict), reject: (reason: unknown) => reject(reason) };
}
const flush = async () => { await new Promise(done => setImmediate(done)); };

test("partial milestones continue without assessing; closed todos request one finish gate", () => {
  const f = fixture(); f.guard.activate("Implement two cases", "build", f.context);
  f.emit("tool_result", { toolName: "todo", details: { tasks: [{ id: 1, subject: "case A", status: "pending" }] } });
  assert.match(f.settle().entries[0].content, /case A/);
  f.emit("tool_result", { toolName: "todo", details: { tasks: [{ id: 1, subject: "case A", status: "completed" }] } });
  assert.match(f.settle().entries[0].content, /Submit finish/);
});

test("known async evidence does not create polling turns or allow premature finish", async () => {
  let busy = true; const f = fixture(() => busy);
  f.guard.activate("Complete A", "build", f.context);
  assert.equal(f.settle(), undefined);
  await assert.rejects(f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "A" }, undefined, undefined, f.context), /asynchronous evidence/);
  busy = false;
  assert.match(f.settle().entries[0].content, /finish/);
});

test("unsupported finish returns missing work; accepted finish settles", async () => {
  const f = fixture(); f.guard.activate("Implement A and B", "build", f.context);
  const args = { outcome: "complete", summary: "A is done", evidence: "test A" };
  const receipt = await f.finish.execute("id", args, undefined, undefined, f.context);
  assert.match((receipt.content[0] as { text: string }).text, /provisional/);
  assert.match(f.assessments[0]!, /Endpoint.*requested implementation/);
  f.resolve({ verdict: "missing", explanation: "B has no proof", missing: ["Implement B"] }); await flush();
  assert.match(f.messages.at(-1)!, /B has no proof/);
  assert.ok(f.settle());
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.resolve({ verdict: "complete", explanation: "A and B verified", missing: [] }); await flush();
  assert.match(f.messages.at(-1)!, /confirmed/);
  assert.equal(f.settle(), undefined);
  f.emit("input", { source: "interactive", text: "Also prove B" });
  assert.match(f.settle().entries[0].content, /finish/);
});

test("session navigation and candidate drift cannot accept late results", async () => {
  const f = fixture(); f.guard.activate("Complete A", "ship", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "done", evidence: "A" }, undefined, undefined, f.context);
  f.emit("tool_result", { toolName: "todo", details: { tasks: [{ id: 2, subject: "A", status: "pending" }] } });
  f.resolve({ verdict: "complete", explanation: "old", missing: [] }); await flush();
  assert.match(f.messages.at(-1)!, /superseded/);
  assert.match(f.settle().entries[0].content, /A/);
});

test("an unsupported blocker never settles, and repeated assessment failures pause explicitly", async () => {
  const f = fixture(); f.guard.activate("Complete A", "build", f.context);
  const args = { outcome: "blocked", summary: "Need human", evidence: "No reason supplied" };
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.resolve({ verdict: "missing", explanation: "Ordinary implementation remains", missing: ["Implement A"] }); await flush();
  assert.match(f.messages.at(-1)!, /Ordinary implementation/);
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.reject(new Error("transport down")); await flush();
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.reject(new Error("transport down")); await flush();
  assert.match(f.messages.at(-1)!, /Incomplete pause/);
  assert.equal(f.settle(), undefined);
});

test("repeated identical missing work without progress pauses instead of retrying forever", async () => {
  const f = fixture(); f.guard.activate("Implement B", "build", f.context);
  const args = { outcome: "complete", summary: "Done", evidence: "test A" };
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.finish.execute("id", args, undefined, undefined, f.context);
    f.resolve({ verdict: "missing", explanation: "B remains", missing: ["Implement B"] }); await flush();
  }
  assert.match(f.messages.at(-1)!, /Incomplete pause/);
  assert.equal(f.settle(), undefined);
});

test("a genuine blocker can settle, while session navigation discards a late assessment", async () => {
  const f = fixture(); f.guard.activate("Publish with human authority", "ship", f.context);
  const args = { outcome: "blocked", summary: "Missing protected-branch approval", evidence: "Human approver unavailable" };
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.resolve({ verdict: "blocked", explanation: "Approval is required and unavailable", missing: [] }); await flush();
  assert.match(f.messages.at(-1)!, /confirmed/);
  assert.equal(f.settle(), undefined);
  f.guard.activate("New request", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "Proof" }, undefined, undefined, f.context);
  f.emit("session_before_switch");
  f.resolve({ verdict: "complete", explanation: "stale", missing: [] }); await flush();
  assert.equal(f.messages.length, 1);
  assert.equal(f.settle(), undefined);
});

test("recovery reads active branch and requires reassessment", async () => {
  const f = fixture(); f.guard.activate("Deliver A", "build", f.context);
  f.emit("session_start", {}, f.context);
  assert.match(f.settle().entries[0].content, /finish/);
  f.guard.cancel(); assert.equal(f.settle(), undefined);
});
