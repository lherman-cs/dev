import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { packageReviewedCandidate, type ShipDecision, type ShipMessage } from "../lib/ship.ts";
import type { RunWorker } from "../lib/worker.ts";

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-test-"));
  const targets: string[] = [];
  t.after(() => {
    for (const target of targets) {
      try { git(root, ["worktree", "unlock", target]); } catch {}
      git(root, ["worktree", "remove", "--force", target]);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Test"]); git(root, ["config", "user.email", "test@example.test"]);
  fs.writeFileSync(path.join(root, "a.txt"), "base\n");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "base"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "feature"]);
  fs.writeFileSync(path.join(root, "a.txt"), "candidate\n"); fs.writeFileSync(path.join(root, "b.txt"), "new\n");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "messy development history"]);
  return { root, baseline, candidate: git(root, ["rev-parse", "HEAD"]), candidateTree: git(root, ["rev-parse", "HEAD^{tree}"]), track: (target: string) => targets.push(target) };
}
const message = { title: "feat: ship candidate", body: "Brief explanation." };
function harness(root: string, overrides: { run?: RunWorker; decide?: (message: ShipMessage) => Promise<ShipDecision> } = {}) {
  let calls = 0, decisions = 0;
  const run: RunWorker = overrides.run ?? (async args => {
    calls++; assert.equal(args.name, "ship"); assert.deepEqual(args.tools, []);
    return message as never;
  });
  return { ship: () => packageReviewedCandidate({ cwd: root, run, decide: async msg => {
    decisions++; assert.deepEqual(msg, message); return overrides.decide?.(msg) ?? "approve";
  } }), get calls() { return calls; }, get decisions() { return decisions; } };
}
const main = (root: string) => git(root, ["rev-parse", "refs/heads/main"]);

test("one approved squash on main, unchanged feature and no shipping branch; retry is a no-op", async t => {
  const f = fixture(t), h = harness(f.root);
  assert.match(await h.ship(), /Shipped .* to local main/);
  assert.equal(git(f.root, ["rev-parse", "main^"]), f.baseline);
  assert.equal(git(f.root, ["rev-parse", "main^{tree}"]), f.candidateTree);
  assert.equal(git(f.root, ["show", "-s", "--format=%B", "main"]), `${message.title}\n\n${message.body}`);
  assert.equal(git(f.root, ["rev-parse", "HEAD"]), f.candidate);
  assert.equal(git(f.root, ["status", "--porcelain"]), "");
  assert.equal(git(f.root, ["branch", "--list", "ship/*"]), "");
  assert.match(await h.ship(), /Nothing to ship/);
  assert.equal(h.calls, 1); assert.equal(h.decisions, 1);
});

test("checked-out main is updated without changing source", async t => {
  const f = fixture(t), target = path.join(path.dirname(f.root), `main-${path.basename(f.root)}`);
  git(f.root, ["worktree", "add", "-q", target, "main"]); f.track(target);
  await harness(f.root).ship();
  assert.equal(fs.readFileSync(path.join(target, "a.txt"), "utf8"), "candidate\n");
  assert.equal(fs.readFileSync(path.join(target, "b.txt"), "utf8"), "new\n");
  assert.equal(git(target, ["status", "--porcelain"]), "");
  assert.equal(git(target, ["rev-parse", "HEAD"]), main(f.root));
  assert.equal(git(f.root, ["rev-parse", "HEAD"]), f.candidate);
});

test("staged, unstaged and untracked source changes each reject before model or approval", async t => {
  for (const dirty of ["staged", "unstaged", "untracked"]) {
    await t.test(dirty, async st => {
      const f = fixture(st), h = harness(f.root);
      if (dirty === "untracked") fs.writeFileSync(path.join(f.root, "stray"), "x");
      else { fs.writeFileSync(path.join(f.root, "a.txt"), "dirty"); if (dirty === "staged") git(f.root, ["add", "a.txt"]); }
      await assert.rejects(h.ship(), /Source feature branch must be clean/);
      assert.equal(h.calls, 0); assert.equal(h.decisions, 0); assert.equal(main(f.root), f.baseline);
    });
  }
});

test("main, detached HEAD, missing main, and unresolved operation reject early", async t => {
  for (const scenario of ["main", "detached", "missing", "merge"]) {
    await t.test(scenario, async st => {
      const f = fixture(st), h = harness(f.root);
      if (scenario === "main") git(f.root, ["switch", "-q", "main"]);
      if (scenario === "detached") git(f.root, ["checkout", "-q", "--detach"]);
      if (scenario === "missing") git(f.root, ["branch", "-D", "main"]);
      if (scenario === "merge") fs.writeFileSync(path.resolve(f.root, git(f.root, ["rev-parse", "--git-path", "MERGE_HEAD"])), f.baseline);
      await assert.rejects(h.ship()); assert.equal(h.calls, 0); assert.equal(h.decisions, 0);
    });
  }
});

test("unintegrated main rejects before model", async t => {
  const f = fixture(t);
  git(f.root, ["switch", "-q", "main"]); fs.writeFileSync(path.join(f.root, "later"), "later"); git(f.root, ["add", "-A"]); git(f.root, ["commit", "-qm", "later"]); git(f.root, ["switch", "-q", "feature"]);
  const h = harness(f.root); await assert.rejects(h.ship(), /not integrated/); assert.equal(h.calls, 0);
});

test("dirty, locked and ignored-obstructed main checkouts reject without losing data", async t => {
  for (const scenario of ["dirty", "locked", "ignored"]) await t.test(scenario, async st => {
    const f = fixture(st), target = path.join(path.dirname(f.root), `main-${path.basename(f.root)}`);
    git(f.root, ["worktree", "add", "-q", target, "main"]); f.track(target);
    if (scenario === "dirty") fs.writeFileSync(path.join(target, "a.txt"), "do not lose");
    if (scenario === "locked") git(f.root, ["worktree", "lock", target]);
    if (scenario === "ignored") {
      fs.appendFileSync(path.resolve(target, git(target, ["rev-parse", "--git-path", "info/exclude"])), "\nb.txt\n");
      fs.writeFileSync(path.join(target, "b.txt"), "do not lose");
    }
    const h = harness(f.root);
    await assert.rejects(h.ship()); assert.equal(h.calls, 0);
    if (scenario === "ignored") assert.equal(fs.readFileSync(path.join(target, "b.txt"), "utf8"), "do not lose");
  });
});

test("tweaks need separate approval; cancel and model failure leave main unchanged", async t => {
  const f = fixture(t); let n = 0;
  const h = harness(f.root, { decide: async () => ++n === 1 ? { tweak: "shorter" } : "cancel" });
  assert.match(await h.ship(), /cancelled/); assert.equal(n, 2); assert.equal(main(f.root), f.baseline);
  await assert.rejects(packageReviewedCandidate({ cwd: f.root, run: async () => { throw new Error("offline"); }, decide: async () => "approve" }), /offline/);
  assert.equal(main(f.root), f.baseline);
});

test("discussion drift invalidates approval", async t => {
  for (const scenario of ["source", "main", "checkout"]) await t.test(scenario, async st => {
    const f = fixture(st), target = path.join(path.dirname(f.root), `main-${path.basename(f.root)}`);
    if (scenario === "checkout") { git(f.root, ["worktree", "add", "-q", target, "main"]); f.track(target); }
    const h = harness(f.root, { decide: async () => {
      if (scenario === "source") fs.writeFileSync(path.join(f.root, "a.txt"), "changed");
      if (scenario === "main") git(f.root, ["update-ref", "refs/heads/main", f.candidate, f.baseline]);
      if (scenario === "checkout") fs.writeFileSync(path.join(target, "stray"), "x");
      return "approve";
    } });
    await assert.rejects(h.ship(), /Approval invalidated/);
    if (scenario !== "main") assert.equal(main(f.root), f.baseline);
  });
});

test("a main ref change in commit hooks invalidates approval before integration", async t => {
  const f = fixture(t), hooks = fs.mkdtempSync(path.join(os.tmpdir(), "ship-hooks-"));
  t.after(() => fs.rmSync(hooks, { recursive: true, force: true }));
  git(f.root, ["config", "core.hooksPath", hooks]);
  fs.writeFileSync(path.join(hooks, "pre-commit"), `#!/bin/sh\ngit update-ref refs/heads/main ${f.candidate} ${f.baseline}\n`, { mode: 0o755 });
  await assert.rejects(harness(f.root).ship(), /Approval invalidated/);
  assert.equal(main(f.root), f.candidate);
});

test("relative configured hooksPath is honored from the source root", async t => {
  const f = fixture(t), hooks = fs.mkdtempSync(path.join(os.tmpdir(), "ship-hooks-"));
  t.after(() => fs.rmSync(hooks, { recursive: true, force: true }));
  git(f.root, ["config", "core.hooksPath", path.relative(f.root, hooks)]);
  fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await assert.rejects(harness(f.root).ship());
  assert.equal(main(f.root), f.baseline);
});

test("post-integration checkout drift reports advanced main without rollback", async t => {
  const f = fixture(t), target = path.join(path.dirname(f.root), `main-${path.basename(f.root)}`), hooks = fs.mkdtempSync(path.join(os.tmpdir(), "ship-hooks-"));
  t.after(() => fs.rmSync(hooks, { recursive: true, force: true }));
  git(f.root, ["worktree", "add", "-q", target, "main"]); f.track(target);
  git(f.root, ["config", "core.hooksPath", hooks]);
  fs.writeFileSync(path.join(hooks, "post-merge"), "#!/bin/sh\necho retained > unexpected\n", { mode: 0o755 });
  await assert.rejects(harness(f.root).ship(), /Shipping interrupted or failed.*Local main is/);
  assert.equal(git(f.root, ["rev-parse", "main^{tree}"]), f.candidateTree);
  assert.equal(fs.readFileSync(path.join(target, "unexpected"), "utf8"), "retained\n");
  const retry = harness(f.root); await assert.rejects(retry.ship(), /Local main checkout must be clean/); assert.equal(retry.calls, 0);
  fs.rmSync(path.join(target, "unexpected")); assert.match(await retry.ship(), /Nothing to ship/);
});

test("configured signing failure blocks publication", async t => {
  const f = fixture(t);
  git(f.root, ["config", "commit.gpgsign", "true"]);
  git(f.root, ["config", "gpg.program", "/nonexistent/dev-ship-signer"]);
  await assert.rejects(harness(f.root).ship());
  assert.equal(main(f.root), f.baseline);
});

test("failing and mutating hooks do not advance main", async t => {
  for (const scenario of ["fail", "message", "tree"]) await t.test(scenario, async st => {
    const f = fixture(st), hooks = fs.mkdtempSync(path.join(os.tmpdir(), "ship-hooks-"));
    st.after(() => fs.rmSync(hooks, { recursive: true, force: true }));
    git(f.root, ["config", "core.hooksPath", hooks]);
    const hook = scenario === "fail" ? "exit 1\n" : scenario === "message" ? "echo changed >> \"$1\"\n" : "echo altered > a.txt\ngit add a.txt\n";
    const file = path.join(hooks, scenario === "message" ? "commit-msg" : "pre-commit");
    fs.writeFileSync(file, `#!/bin/sh\n${hook}`, { mode: 0o755 });
    await assert.rejects(harness(f.root).ship()); assert.equal(main(f.root), f.baseline);
  });
});
