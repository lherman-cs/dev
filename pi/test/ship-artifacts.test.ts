import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { shipArtifacts } from "../lib/ship-artifacts.ts";

test("artifact read checks approval, content hashes and real repository containment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-artifacts-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ship-outside-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    fs.writeFileSync(path.join(root, "spec.md"), "Status: APPROVED\n");
    fs.writeFileSync(path.join(root, "plan.md"), "Status: APPROVED\n");
    const first = shipArtifacts(root, "spec.md", "plan.md");
    assert.match(first.spec.sha256, /^[a-f0-9]{64}$/);
    assert.equal(shipArtifacts(root, "spec.md").plan, undefined);
    assert.equal(shipArtifacts(root, "spec.md").spec.sha256, first.spec.sha256);
    fs.writeFileSync(path.join(root, "plan.md"), "Status: APPROVED\nchanged\n");
    assert.notEqual(first.plan?.sha256, shipArtifacts(root, "spec.md", "plan.md").plan?.sha256);
    fs.writeFileSync(path.join(root, "plan.md"), "Status: DRAFT\n");
    assert.throws(() => shipArtifacts(root, "spec.md", "plan.md"), /not approved/);
    assert.match(shipArtifacts(root, "spec.md").spec.sha256, /^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(outside, "approved.md"), "Status: APPROVED\n");
    fs.rmSync(path.join(root, "spec.md"));
    fs.symlinkSync(path.join(outside, "approved.md"), path.join(root, "spec.md"));
    assert.throws(() => shipArtifacts(root, "spec.md", "plan.md"), /escapes the repository/);
    fs.rmSync(path.join(root, "spec.md"));
    fs.writeFileSync(path.join(root, "spec.md"), "Status: DRAFT\n");
    assert.throws(() => shipArtifacts(root, "spec.md", "plan.md"), /not approved/);
    assert.throws(() => shipArtifacts(root, "../outside", "plan.md"), /Invalid approved artifact/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
