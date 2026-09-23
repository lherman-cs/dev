import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCompletionGuard } from "../lib/completion-guard.ts";
import type { RunWorker } from "../lib/worker.ts";

function fixture(hasAsyncWork = () => false, deliveryFails = false, cwd = process.cwd()) {
  const manager = SessionManager.inMemory(cwd);
  const context = { cwd, sessionManager: manager, hasUI: false, ui: { notify: () => undefined, setWidget: () => undefined } } as unknown as ExtensionContext;
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const tools: ToolDefinition[] = [], messages: string[] = [], assessments: Array<{ name: string; task: string }> = [];
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const run = ((args: { name: string; task: string }) => { assessments.push(args); return new Promise<unknown>((done, fail) => { resolve = done; reject = fail; }); }) as RunWorker;
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => {
      handlers.set(name, [...(handlers.get(name) || []), handler]); return () => undefined;
    },
    registerTool: (tool: ToolDefinition) => { tools.push(tool); },
    appendEntry: (name: string, data: unknown) => { manager.appendCustomEntry(name, data); },
    sendMessage: (message: { content: string }) => { if (deliveryFails) throw new Error("queue unavailable"); messages.push(message.content); },
  } as unknown as ExtensionAPI;
  const guard = registerCompletionGuard(pi, run, hasAsyncWork);
  const emit = (name: string, event: any = {}, ctx = context) => handlers.get(name)?.map(fn => fn(event, ctx));
  const finish = tools.find(t => t.name === "finish")!, control = tools.find(t => t.name === "goal_control")!;
  const settle = () => emit("agent_before_settle", { outcome: "completed", context: { canContinue: true } })?.[0];
  return { guard, emit, finish, control, settle, context, manager, messages, assessments,
    resolve: (verdict: unknown) => resolve(verdict), reject: (reason: unknown) => reject(reason) };
}
const flush = async () => { await new Promise(done => setImmediate(done)); };
function scratchRepo(fn: (cwd: string) => Promise<void>) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-goal-"));
  execFileSync("git", ["init", "-q", cwd]);
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "--allow-empty", "-qm", "base"]);
  return fn(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

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
  assert.equal(f.assessments[0]?.name, "assessor");
  assert.match(f.assessments[0]!.task, /Endpoint.*requested implementation/);
  f.resolve({ verdict: "missing", explanation: "B has no proof", missing: ["Implement B"] }); await flush();
  assert.match(f.messages.at(-1)!, /B has no proof/);
  assert.ok(f.settle());
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.resolve({ verdict: "complete", explanation: "A and B verified", missing: [] }); await flush();
  assert.ok(f.messages.some(message => /confirmed/.test(message)));
  assert.equal(f.settle(), undefined);
  f.emit("input", { source: "interactive", text: "Also prove B" });
  assert.equal(f.settle(), undefined); // Completed identity stays historical.
});

test("session navigation and candidate drift cannot accept late results", async () => {
  const f = fixture(); f.guard.activate("Complete A", "ship", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "done", evidence: "A" }, undefined, undefined, f.context);
  f.emit("tool_result", { toolName: "todo", details: { tasks: [{ id: 2, subject: "A", status: "pending" }] } });
  f.resolve({ verdict: "complete", explanation: "old", missing: [] }); await flush();
  assert.ok(f.messages.some(message => /superseded/.test(message)));
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
  assert.match(f.messages.at(-1)!, /unavailable/i);
  assert.equal(f.settle(), undefined);
});

test("failed assessment delivery cannot silently certify completion", async () => {
  const f = fixture(() => false, true); f.guard.activate("Complete A", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "test A" }, undefined, undefined, f.context);
  f.resolve({ verdict: "complete", explanation: "verified", missing: [] }); await flush();
  assert.equal(f.messages.length, 0);
  assert.equal(f.settle(), undefined);
  const record = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal").at(-1);
  assert.match(String(record?.type === "custom" && (record.data as { reason?: string }).reason), /delivery failed/i);
});

test("repeated identical missing work without progress pauses instead of retrying forever", async () => {
  const f = fixture(); f.guard.activate("Implement B", "build", f.context);
  const args = { outcome: "complete", summary: "Done", evidence: "test A" };
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.finish.execute("id", args, undefined, undefined, f.context);
    f.resolve({ verdict: "missing", explanation: "B remains", missing: ["Implement B"] }); await flush();
  }
  assert.match(f.messages.at(-1)!, /Repeated identical/);
  assert.equal(f.settle(), undefined);
});

test("a genuine blocker can settle, while session navigation discards a late assessment", async () => {
  const f = fixture(); f.guard.activate("Publish with human authority", "ship", f.context);
  const args = { outcome: "blocked", summary: "Missing protected-branch approval", evidence: "Human approver unavailable" };
  await f.finish.execute("id", args, undefined, undefined, f.context);
  f.resolve({ verdict: "blocked", explanation: "Approval is required and unavailable", missing: [] }); await flush();
  assert.ok(f.messages.some(message => /confirmed/.test(message)));
  assert.equal(f.settle(), undefined);
  f.guard.abandon(); // Blocked goal must be explicitly ended before replacing it in a non-interactive session.
  await f.guard.activate("New request", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "Proof" }, undefined, undefined, f.context);
  f.emit("session_before_switch");
  f.resolve({ verdict: "complete", explanation: "stale", missing: [] }); await flush();
  assert.equal(f.messages.filter(message => /stale/.test(message)).length, 0);
  assert.equal(f.settle(), undefined);
});

test("untracked contents, including changes beyond the displayed evidence window, invalidate pending proof", () => scratchRepo(async cwd => {
  const f = fixture(() => false, false, cwd); await f.guard.activate("Deliver artifact", "build", f.context);
  const file = join(cwd, "artifact.txt");
  writeFileSync(file, "A".repeat(30000));
  await f.finish.execute("id", { outcome: "complete", summary: "Delivered", evidence: "artifact" }, undefined, undefined, f.context);
  writeFileSync(file, "A".repeat(29999) + "B");
  f.resolve({ verdict: "complete", explanation: "Verified old version", missing: [] }); await flush();
  assert.ok(f.messages.some(m => /superseded/.test(m)));
  assert.match(f.settle().entries[0].content, /finish/);
}));

test("an ignored referenced plan edit invalidates in-flight acceptance", () => scratchRepo(async cwd => {
  writeFileSync(join(cwd, ".gitignore"), "plans/\n");
  mkdirSync(join(cwd, "plans")); const spec = join(cwd, "plans", "spec.md"); writeFileSync(spec, "Requirement A");
  const f = fixture(() => false, false, cwd); await f.guard.activate("Implement ./plans/spec.md", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "./plans/spec.md" }, undefined, undefined, f.context);
  writeFileSync(spec, "Requirement B");
  f.resolve({ verdict: "complete", explanation: "Old plan", missing: [] }); await flush();
  assert.ok(f.messages.some(message => /superseded/.test(message)));
}));

test("a tracked deletion remains identifiable rather than becoming an uncheckable candidate", () => scratchRepo(async cwd => {
  const file = join(cwd, "tracked.txt"); writeFileSync(file, "before");
  execFileSync("git", ["-C", cwd, "add", "tracked.txt"]);
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=t@example.org", "commit", "-qm", "add file"]);
  unlinkSync(file);
  const f = fixture(() => false, false, cwd); await f.guard.activate("Remove old file", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Removed", evidence: "git status" }, undefined, undefined, f.context);
  assert.match(f.assessments[0]!.task, / D tracked.txt/);
}));

test("a non-Git project has content-bound evidence rather than an unchanged fallback", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-nongit-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const file = join(cwd, "artifact.txt"); writeFileSync(file, "before");
  const f = fixture(() => false, false, cwd); await f.guard.activate("Change artifact", undefined, f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Changed", evidence: "artifact" }, undefined, undefined, f.context);
  writeFileSync(file, "after");
  f.resolve({ verdict: "complete", explanation: "Old version", missing: [] }); await flush();
  assert.ok(f.messages.some(m => /superseded/.test(m)));
});

test("accepted evidence must still describe the candidate at settlement", () => scratchRepo(async cwd => {
  const f = fixture(() => false, false, cwd); await f.guard.activate("Deliver artifact", "ship", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "proof" }, undefined, undefined, f.context);
  f.resolve({ verdict: "complete", explanation: "Checked", missing: [] }); await flush();
  writeFileSync(join(cwd, "new.txt"), "Changed after assessment");
  assert.match(f.settle().entries[0].content, /fresh finish|Submit finish/);
  const record = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal").at(-1);
  assert.equal(record?.type === "custom" && (record.data as { status: string }).status, "Active");
}));

test("paused work is read-only until explicit resume; canContinue false pauses without a loop", async () => {
  const f = fixture(); await f.guard.activate("Fix code", "build", f.context);
  f.emit("input", { source: "interactive", text: "Unrelated side question" });
  assert.ok(f.emit("tool_call", { toolName: "edit", input: {} })?.[0]?.block);
  assert.equal(f.emit("tool_call", { toolName: "read", input: {} })?.[0], undefined);
  assert.match(f.emit("before_agent_start")?.[0]?.message.content, /Do not perform goal work/);
  f.guard.resume(f.context);
  assert.equal(f.emit("tool_call", { toolName: "edit", input: {} })?.[0], undefined);
  assert.equal(f.emit("agent_before_settle", { outcome: "completed", context: { canContinue: false } })?.[0], undefined);
  assert.ok(f.emit("tool_call", { toolName: "edit", input: {} })?.[0]?.block);
});

test("todo reset cannot reattribute a reused id to an earlier goal task", async () => {
  const f = fixture(); await f.guard.activate("Complete original case", "build", f.context);
  f.emit("tool_result", { toolName: "todo", input: { action: "create" }, details: { tasks: [{ id: 1, subject: "original", status: "pending" }], nextId: 2 } });
  f.emit("tool_result", { toolName: "todo", input: { action: "clear" }, details: { tasks: [], nextId: 1 } });
  f.emit("tool_result", { toolName: "todo", input: { action: "create" }, details: { tasks: [{ id: 1, subject: "replacement", status: "completed" }], nextId: 2 } });
  assert.match(f.settle().entries[0].content, /original/);
});

test("model-only control cannot abandon or resume without fresh human input", async () => {
  const f = fixture(); await f.guard.activate("Build A", "build", f.context);
  await assert.rejects(f.control.execute("id", { action: "abandon" }, undefined, undefined, f.context), /direct current human instruction/);
  f.emit("input", { source: "interactive", text: "Stop building A" });
  await f.control.execute("id", { action: "abandon" }, undefined, undefined, f.context);
  assert.equal(f.settle(), undefined);
});

test("checking completion forbids new mutating work until evidence arrives", async () => {
  const f = fixture(); await f.guard.activate("Build A", "build", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "A" }, undefined, undefined, f.context);
  assert.match(f.emit("tool_call", { toolName: "edit", input: { path: "x" } })?.[0]?.reason ?? "", /Wait for the assessor/);
  assert.equal(f.emit("tool_call", { toolName: "read", input: { path: "x" } })?.[0], undefined);
  f.guard.pause();
  f.resolve({ verdict: "complete", explanation: "stale", missing: [] }); await flush();
});

test("pause and resume in the same session invalidates an assessor already in flight", async () => {
  const f = fixture(); await f.guard.activate("Deliver A", "ship", f.context);
  await f.finish.execute("id", { outcome: "complete", summary: "Done", evidence: "A" }, undefined, undefined, f.context);
  f.guard.pause("Human interrupted");
  f.guard.resume(f.context);
  f.resolve({ verdict: "complete", explanation: "Old proof", missing: [] }); await flush();
  assert.equal(f.messages.some(message => /Old proof/.test(message)), false);
  assert.match(f.settle().entries[0].content, /finish/);
});

test("a forked branch gets a distinct paused identity and cannot inherit acceptance", async () => {
  const f = fixture(); await f.guard.activate("Deliver A", "build", f.context);
  const parent = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal").at(-1);
  assert.ok(parent && parent.type === "custom");
  f.emit("session_before_fork");
  f.manager.newSession();
  f.manager.appendCustomEntry("dev-goal", parent.data);
  f.emit("session_start");
  const fork = f.manager.getBranch().filter(e => e.type === "custom" && e.customType === "dev-goal").at(-1);
  assert.ok(fork && fork.type === "custom");
  assert.notEqual((fork.data as { id: string }).id, (parent.data as { id: string }).id);
  assert.equal((fork.data as { status: string }).status, "Paused");
  assert.equal(f.settle(), undefined);
});

test("recovery reads active branch and requires reassessment", async () => {
  const f = fixture(); f.guard.activate("Deliver A", "build", f.context);
  f.emit("session_start", {}, f.context);
  assert.equal(f.settle(), undefined);
  f.guard.resume(f.context); assert.match(f.settle().entries[0].content, /finish/);
  f.guard.cancel(); assert.equal(f.settle(), undefined);
});
