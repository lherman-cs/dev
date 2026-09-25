// Manual browser acceptance fixture: node test/workspace-walkthrough.mjs
// Starts isolated loopback Spec and Review workspaces with representative content.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { SpecWorkspace } from "../lib/spec-workspace.ts";
import { ReviewWorkspace } from "../lib/review-workspace.ts";
import { WorkspaceWeb } from "../lib/workspace-web.ts";

const root = await mkdtemp(join(tmpdir(), "dev-workspace-walkthrough-"));
const specPath = join(root, "plans", "atlas", "spec.md");
await mkdir(join(root, "plans", "atlas"), { recursive: true });
const earlyPath = join(root, "plans", "new-brief", "spec.md");
await mkdir(join(root, "plans", "new-brief"), { recursive: true });
await writeFile(earlyPath, "Status: DRAFT\n\n# New brief\n\nThe intended outcome is not yet settled.\n");
const early = new SpecWorkspace(earlyPath, join(root, "early-state.json"), root);
await early.restore();
const original = "Status: DRAFT\n\n# Atlas product brief\n\n## Outcome\nBring incident handoffs into one shared workspace.\n\n## Scope\n- Capture ownership and the next action.\n- Exclude on-call scheduling and paging.\n";
const evolved = original.replace("Capture ownership and the next action.", "Capture ownership, the next action, and a timestamped handoff history.");
await writeFile(specPath, original);
const spec = new SpecWorkspace(specPath, join(root, "spec-state.json"), root);
await spec.restore();
await spec.publish({ markdown: original, recommendation: "Start with a local, single-team handoff log. Defer paging and scheduling.", sections: [
  { id: "why", kind: "motivation", title: "Why this matters", body: "Handoffs are currently scattered across chat, creating ambiguity about **who owns the next action**. Atlas provides a single place to find the current owner." },
  { id: "requirements", kind: "requirement", title: "Settled requirements", body: "- A teammate records the current owner and next action.\n- Each handoff retains its previous owner.\n- The view remains readable without a connected pager." },
  { id: "boundaries", kind: "scope", title: "Not in the first release", body: "No on-call schedules, paging, or remote account provisioning. Those require separate policy and ownership decisions." },
], decisions: [{ id: "history", subject: "Handoff history", recommendation: "Keep a timestamped local history of each reassignment.", consequence: "Improves accountability but adds storage and retention obligations." }] });
await spec.addHuman("requirements", "What happens if two teammates update the owner at once?");
await writeFile(specPath, evolved);
await spec.publish({ markdown: evolved, recommendation: "Keep a timestamped handoff history while preserving a single current owner.", sections: [
  { id: "why", kind: "motivation", title: "Why this matters", body: "Handoffs are currently scattered across chat, creating ambiguity about **who owns the next action**. Atlas provides a single place to find the current owner." },
  { id: "requirements", kind: "requirement", title: "Settled requirements", body: "- Record the current owner, next action and timestamped handoff history.\n- Resolve concurrent handoffs by rejecting the older version and prompting a retry.\n- Remain readable without a connected pager." },
  { id: "boundaries", kind: "scope", title: "Not in the first release", body: "No on-call schedules, paging, or remote account provisioning. Those require separate policy and ownership decisions." },
], decisions: [{ id: "history", subject: "Handoff history", recommendation: "Keep a timestamped local history of each reassignment.", consequence: "Improves accountability but adds storage and retention obligations." }] });
const repo = join(root, "candidate"); await mkdir(repo);
const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
git("init", "-b", "main"); git("config", "user.name", "Workspace Demo"); git("config", "user.email", "demo@example.test");
await writeFile(join(repo, "README.md"), "# Atlas\n"); git("add", "."); git("commit", "-m", "atlas demo candidate");
const review = new ReviewWorkspace(repo, join(root, "review-state.json")); await review.restore();
await review.publish({ recommendation: "Ready for an explicit decision on retention. The candidate is otherwise suitable for local release packaging, not remote deployment.", sections: [
  { id: "outcome", title: "Outcome and behavior", kind: "outcome", body: "**Before:** ownership lived in chat and the next action was easy to lose.\n\n**After:** Atlas records one current owner, a next action, and a timestamped handoff trail. Two concurrent updates cannot silently overwrite one another." },
  { id: "design", title: "Design and tradeoffs", kind: "design", body: "The write path checks the expected version before it appends a handoff. This keeps the latest owner unambiguous, at the cost of an occasional retry for concurrent editors.\n\nThe history is local to this candidate. Cross-device sync is outside this assessment." },
  { id: "evidence", title: "Evidence and limits", kind: "evidence", body: "- Typecheck and targeted behavior tests passed for the assessed commit.\n- A browser walkthrough covered wide and narrow layouts, keyboard focus, and contextual discussion.\n- No production retention policy or external integration test was performed." },
  { id: "system", title: "Request and storage path", kind: "system", body: "The browser never writes the committed candidate directly. The service validates the revision before recording a request.\n\n```mermaid\nflowchart LR\n  Human[Human review] --> Browser[Local browser]\n  Browser --> Service[Loopback workspace]\n  Service --> Agent[Pi review agent]\n  Agent --> Repo[Local candidate]\n```" },
  { id: "risk", title: "Retention needs an owner", kind: "risk", body: "The local handoff history is persistent. Without an agreed retention period, old ownership information may outlive its useful purpose. Waiving this risk accepts that exposure for this candidate only." },
  { id: "code", title: "Relevant code", kind: "code", body: "The version check belongs in the service write path. The UI supplies the expected revision but is **not** the authorization boundary.\n\n```ts\nif (expectedVersion !== current.version) throw new Error('Stale revision')\n```" },
], decisions: [{ id: "retention", subject: "Retention policy gap", kind: "risk", recommendation: "Document a retention owner before remote rollout.", consequence: "Waiving retains the disclosure and limits approval to the reviewed local candidate.", context: { mentalModel: "The local history is persistent, but remote rollout is out of scope.", explanation: "A waiver leaves the policy gap visible rather than treating it as fixed.", evidence: ["The assessed candidate passes targeted checks; retention policy is not tested."], code: ["README.md:1"] }, visual: { type: "sequence_flow", steps: ["Handoff recorded", "History retained", "Policy decision"] } }] });
const earlyWeb = new WorkspaceWeb(), specWeb = new WorkspaceWeb(), reviewWeb = new WorkspaceWeb();
console.log(`Early ${await earlyWeb.open({ phase: "spec", store: early, project: "New brief", active: () => true, send: () => {} })}`);
console.log(`Spec ${await specWeb.open({ phase: "spec", store: spec, project: "Atlas", active: () => true, send: () => {} })}`);
console.log(`Review ${await reviewWeb.open({ phase: "review", store: review, project: "Atlas", active: () => true, send: () => {} })}`);
console.log("Press Ctrl+C to close isolated demo services.");
const cleanup = async () => { await earlyWeb.close(); await specWeb.close(); await reviewWeb.close(); await rm(root, { recursive: true, force: true }); process.exit(0); };
process.on("SIGINT", () => { void cleanup(); }); process.on("SIGTERM", () => { void cleanup(); });
