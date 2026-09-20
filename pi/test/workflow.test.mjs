import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { encode, decode } from "@toon-format/toon";
import { config, role } from "../lib/roles.mjs";
import { resolveProject, runWorkflow } from "../lib/workflow.mjs";

const expected = {
  spec: "openai/gpt-5.6-sol:medium", plan: "openai/gpt-5.6-sol:high",
  build: "openai/gpt-5.6-sol:low", build_retry: "openai/gpt-5.6-sol:medium",
  prepare: "openai/gpt-5.6-luna:medium", review: "openai/gpt-6-astra:low",
  ship: "openai/gpt-5.6-luna:medium", explorer: "openai/gpt-5.6-luna:medium",
};
test("exact user roles; Codex is the authentication transport, not a different model", () => {
  assert.deepEqual(config.roles, expected);
  for (const name of Object.keys(expected)) {
    const r = role(name); assert.equal(r.provider, "openai-codex");
    assert.equal(`openai/${r.model}:${r.thinking}`, expected[name]);
  }
});

function fixture(t, { manifest = true, taskCount = 2 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-pi-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "seed"), "seed\n"); git("add", "seed"); git("commit", "-qm", "test: seed");
  const base = git("rev-parse", "HEAD");
  const dir = path.join(root, "plans", "media signaling core");
  fs.mkdirSync(path.join(dir, "plans"), { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), "Status: APPROVED\n");
  const write = (file, data) => fs.writeFileSync(file, encode(data) + "\n");
  if (manifest) write(path.join(dir, "project.toon"), { name: "media signaling core", status: "ready", base, final_checks: [] });
  for (let i = 1; i <= taskCount; i++) {
    const id = `P00${i}`;
    write(path.join(dir, "plans", `${id}.toon`), { id, title: `task ${i}`, goal: "Create tested output", depends_on: i === 1 ? [] : ["P001"], checks: [`test "$(cat output-${i})" = good`] });
  }
  const calls = [];
  const h = {
    cwd: root,
    async exec(program, args) {
      try { return { code: 0, stdout: execFileSync(program, args, { cwd: this.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" }; }
      catch (e) { return { code: e.status || -1, stdout: e.stdout || "", stderr: e.stderr || e.message }; }
    },
    async delegate(name, task) {
      calls.push(name);
      const id = /P00([12])\.toon/.exec(task)?.[1];
      assert.ok(id, task);
      fs.writeFileSync(path.join(root, `output-${id}`), id === "2" && name === "build" ? "bad" : "good");
      git("add", `output-${id}`);
      git("commit", ...(name === "build_retry" ? ["--amend"] : []), "-qm", "feat: implement contract");
      return "Completed.";
    },
    select: async () => { throw new Error("unexpected selector"); },
    confirm: async () => false,
    report: () => {},
  };
  return { h, root, dir, base, git, calls, target: "./plans/media signaling core/spec.md", write };
}

test("real spec path with spaces, real TOON, bounded retry, two clean commits, local exclude", async t => {
  const f = fixture(t);
  await runWorkflow(f.h, "build", f.target);
  assert.deepEqual(f.calls, ["build", "build", "build_retry"]);
  assert.equal(f.git("rev-list", "--count", `${f.base}..HEAD`), "2");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(fs.existsSync(path.join(f.root, ".gitignore")), false);
  assert.match(fs.readFileSync(path.join(f.root, ".git/info/exclude"), "utf8"), /^\/plans\/$/m);
  assert.deepEqual(decode(fs.readFileSync(path.join(f.dir, "progress.toon"), "utf8")).done, ["P001", "P002"]);
  await runWorkflow(f.h, "build", f.target);
  assert.equal(f.calls.length, 3, "resume must not repeat completed work");
});

test("spec without a manifest reports the actual missing planning step", async t => {
  const f = fixture(t, { manifest: false });
  assert.deepEqual(await resolveProject(f.h, f.target), { root: f.root, dir: f.dir });
  await assert.rejects(runWorkflow(f.h, "build", f.target), /Found .*spec\.md, but no execution plan/);
  assert.equal(f.calls.length, 0);
});

test("missing path reports absolute lookup and cwd, not a guessed project", async t => {
  const f = fixture(t);
  await assert.rejects(resolveProject(f.h, "./missing/spec.md"), /Target does not exist:.*working directory:/);
});

test("authentication/plugin failure stops once, never falls through to build_retry", async t => {
  const f = fixture(t);
  let count = 0;
  f.h.delegate = async () => { count++; throw new Error("No Codex login; authenticate in Pi"); };
  await assert.rejects(runWorkflow(f.h, "build", f.target), /No Codex login/);
  assert.equal(count, 1); assert.equal(f.git("rev-parse", "HEAD"), f.base);
  assert.deepEqual(decode(fs.readFileSync(path.join(f.dir, "progress.toon"), "utf8")).done, []);
});

test("recovery after a committed child loses its response does not duplicate that commit", async t => {
  const f = fixture(t, { taskCount: 1 });
  const delegate = f.h.delegate;
  f.h.delegate = async (...args) => { await delegate(...args); throw new Error("lost reply"); };
  await assert.rejects(runWorkflow(f.h, "build", f.target), /lost reply/);
  f.h.delegate = delegate;
  await runWorkflow(f.h, "build", f.target);
  assert.deepEqual(f.calls, ["build"]); assert.equal(f.git("rev-list", "--count", `${f.base}..HEAD`), "1");
});

test("unrelated changes are not adopted automatically", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "unrelated"), "user work");
  await assert.rejects(runWorkflow(f.h, "build", f.target), /unrelated changes/);
  assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(path.join(f.root, "unrelated"), "utf8"), "user work");
});

test("prepare never quietly starts an unfinished build", async t => {
  const f = fixture(t);
  await assert.rejects(runWorkflow(f.h, "prepare", f.target), /Prepare does not start implementation/);
  assert.equal(f.calls.length, 0);
});

