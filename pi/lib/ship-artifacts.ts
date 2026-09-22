import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface ApprovedArtifact { path: string; sha256: string }

/** Report approval markers and hashes, not scope or permission to ship. */
export function shipArtifacts(cwd: string, specPath: string, planPath?: string): { spec: ApprovedArtifact; plan?: ApprovedArtifact } {
  const root = fs.realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim());
  const artifact = (name: string): ApprovedArtifact => {
    const absolute = path.resolve(root, name);
    const relative = path.relative(root, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid approved artifact: ${name}`);
    const realArtifact = fs.realpathSync(absolute);
    const realRelative = path.relative(root, realArtifact);
    if (!realRelative || realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative) || !fs.statSync(realArtifact).isFile()) throw new Error(`Approved artifact escapes the repository: ${name}`);
    const content = fs.readFileSync(realArtifact);
    if (!/^Status: APPROVED\b/m.test(content.toString("utf8"))) throw new Error(`Artifact is not approved: ${relative}`);
    return { path: relative, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  };
  return { spec: artifact(specPath), ...(planPath === undefined ? {} : { plan: artifact(planPath) }) };
}
