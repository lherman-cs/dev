import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readOnlySnapshot } from "../lib/worker.ts";
import { candidateFingerprint } from "../lib/verifier.ts";
import { WorkerHistory } from "../lib/worker-history.ts";

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("an exact review snapshot includes tracked edits, deletions, modes, symlinks, and untracked files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-source-"));
  let snapshot: ReturnType<typeof readOnlySnapshot> | undefined;
  t.after(() => { snapshot?.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "changed.txt"), "before\n");
  fs.writeFileSync(path.join(root, "deleted.txt"), "delete me\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "initial");
  fs.writeFileSync(path.join(root, "changed.txt"), "after\n");
  fs.rmSync(path.join(root, "deleted.txt"));
  fs.writeFileSync(path.join(root, "executable.sh"), "#!/bin/sh\n", { mode: 0o755 });
  fs.symlinkSync("changed.txt", path.join(root, "link.txt"));
  const candidate = candidateFingerprint(root);

  snapshot = readOnlySnapshot(root, candidate);
  assert.equal(candidateFingerprint(snapshot.cwd), candidate);
  assert.equal(fs.readFileSync(path.join(snapshot.cwd, "changed.txt"), "utf8"), "after\n");
  assert.equal(fs.existsSync(path.join(snapshot.cwd, "deleted.txt")), false);
  assert.equal(fs.statSync(path.join(snapshot.cwd, "executable.sh")).mode & 0o777, 0o755);
  assert.equal(fs.readlinkSync(path.join(snapshot.cwd, "link.txt")), "changed.txt");
  fs.writeFileSync(path.join(root, "changed.txt"), "drifted\n");
  assert.equal(fs.readFileSync(path.join(snapshot.cwd, "changed.txt"), "utf8"), "after\n");
  assert.throws(() => readOnlySnapshot(root, candidate), /does not match/);
});

test("an abandoned read-only snapshot cannot block a new agent; history survives cleanup", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-source-"));
  let abandoned: ReturnType<typeof readOnlySnapshot> | undefined;
  let fresh: ReturnType<typeof readOnlySnapshot> | undefined;
  t.after(() => { abandoned?.dispose(); fresh?.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "proof.txt"), "committed\n");
  git(root, "add", "proof.txt");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "initial");
  const parent = SessionManager.create(root, path.join(root, ".sessions"));
  const history = new WorkerHistory(parent);
  fs.writeFileSync(path.join(root, "proof.txt"), "partial edit\n");

  abandoned = readOnlySnapshot(root);
  fresh = readOnlySnapshot(root);
  assert.notEqual(fresh.cwd, abandoned.cwd);
  assert.notEqual(git(fresh.cwd, "rev-parse", "--show-toplevel"), root);
  assert.equal(fs.readFileSync(path.join(fresh.cwd, "proof.txt"), "utf8"), "committed\n");
  assert.equal(fs.readFileSync(path.join(root, "proof.txt"), "utf8"), "partial edit\n");

  const manager = history.create(fresh.cwd, { id: "evidence", metadata: { readOnly: true, ownerCwd: root, snapshotCwd: fresh.cwd } });
  const file = manager.getSessionFile(); assert.ok(file);
  fresh.dispose();
  assert.equal(history.open(file).getCwd(), fresh.cwd);
  assert.equal(fs.existsSync(fresh.cwd), false);
  const third = readOnlySnapshot(root);
  assert.equal(fs.readFileSync(path.join(third.cwd, "proof.txt"), "utf8"), "committed\n");
  third.dispose();
});
