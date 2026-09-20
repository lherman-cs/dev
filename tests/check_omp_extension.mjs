import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = path.join(root, "dotfiles/.omp/agent/extensions/dev-workflow.ts");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dev-omp-test-"));
const modulePath = path.join(tmp, "dev-workflow.mjs");
fs.copyFileSync(source, modulePath);

// Node syntax/load check. The extension is intentionally plain JS-compatible TS.
const bin = path.join(tmp, "bin");
const repoDir = path.join(tmp, "repo");
const calls = path.join(tmp, "omp-calls.jsonl");
fs.mkdirSync(bin);
fs.mkdirSync(repoDir);

const fakeToon = `#!/usr/bin/env node
const fs=require("fs");
const a=process.argv.slice(2);
if(a[0]==="--encode"){
  let s=""; process.stdin.setEncoding("utf8");
  process.stdin.on("data",d=>s+=d);
  process.stdin.on("end",()=>process.stdout.write(s));
} else {
  process.stdout.write(fs.readFileSync(a[0],"utf8"));
}
`;
fs.writeFileSync(path.join(bin, "toon"), fakeToon, { mode: 0o755 });

const fakeOmp = `#!/usr/bin/env node
const fs=require("fs"), cp=require("child_process"), path=require("path");
const args=process.argv.slice(2);
fs.appendFileSync(process.env.OMP_CALLS, JSON.stringify(args)+"\\n");
const mi=args.indexOf("--model");
const role=mi>=0?args[mi+1]:"";
const prompt=args.at(-1) || "";
const match=/^Execution contract: (.+)$/m.exec(prompt);
if(!match){
  const msg={role:"assistant",content:[{type:"text",text:"{}"}],usage:{totalTokens:10}};
  process.stdout.write(JSON.stringify({type:"message_end",message:msg})+"\\n");
  process.exit(0);
}
const plan=JSON.parse(fs.readFileSync(match[1],"utf8"));
if(plan.id==="P002" && role==="@builder"){
  process.stderr.write("simulated first-attempt failure\\n");
  process.exit(1);
}
fs.writeFileSync(path.join(process.cwd(), "built-"+plan.id+".txt"), plan.id+"\\n");
cp.execFileSync("git",["add","built-"+plan.id+".txt"]);
cp.execFileSync("git",["-c","user.name=OMP Test","-c","user.email=omp@test.invalid","commit","-m","feat(test): implement contract"],{stdio:"ignore"});
const msg={role:"assistant",content:[{type:"text",text:"implemented "+plan.id}],usage:{totalTokens:100}};
process.stdout.write(JSON.stringify({type:"message_end",message:msg})+"\\n");
`;
fs.writeFileSync(path.join(bin, "omp"), fakeOmp, { mode: 0o755 });

execFileSync("git", ["init", "-q"], { cwd: repoDir });
fs.writeFileSync(path.join(repoDir, "seed.txt"), "seed\n");
execFileSync("git", ["add", "seed.txt"], { cwd: repoDir });
execFileSync("git", ["-c", "user.name=OMP Test", "-c", "user.email=omp@test.invalid", "commit", "-qm", "seed"], { cwd: repoDir });
const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();

const projectDir = path.join(repoDir, "plans", "demo");
const planDir = path.join(projectDir, "plans");
fs.mkdirSync(planDir, { recursive: true });
fs.mkdirSync(path.join(projectDir, "repairs"), { recursive: true });
fs.writeFileSync(path.join(projectDir, "spec.md"), "Status: APPROVED\n");
fs.writeFileSync(path.join(projectDir, "project.toon"), JSON.stringify({
  version: 1, name: "demo", status: "ready", base, depends_on: [], final_checks: []
}));
fs.writeFileSync(path.join(planDir, "P001.toon"), JSON.stringify({
  version: 1, id: "P001", title: "one", depends_on: [], checks: ["test -f built-P001.txt"]
}));
fs.writeFileSync(path.join(planDir, "P002.toon"), JSON.stringify({
  version: 1, id: "P002", title: "two", depends_on: ["P001"], checks: ["test -f built-P002.txt"]
}));

process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.OMP_CALLS = calls;
process.env.DEV_WORKFLOW_SKILL_ROOT = path.join(root, "dotfiles/.omp/agent/skills");
process.env.DEV_WORKFLOW_CONFIG = path.join(root, "dotfiles/.omp/agent/dev-workflow.yml");
process.env.DEV_WORKFLOW_LOCAL_CONFIG = path.join(tmp, "missing-local.yml");

const { default: extension } = await import(pathToFileURL(modulePath).href + "?t=" + Date.now());
const commands = new Map();
extension({
  registerCommand: (name, def) => commands.set(name, def),
});
for (const name of ["dev-build","dev-prepare","dev-review","dev-ship"]) {
  if (!commands.has(name)) throw new Error("missing /"+name);
}

const notifications=[];
const ctx = {
  cwd: repoDir,
  hasUI: false,
  ui: {
    setStatus: () => {},
    setWidget: () => {},
    notify: (message, kind) => notifications.push({message,kind}),
    select: async () => undefined,
    editor: async () => undefined,
  },
};

await commands.get("dev-build").handler("demo", ctx);

const progress = JSON.parse(fs.readFileSync(path.join(projectDir, "progress.toon"), "utf8"));
if (JSON.stringify(progress.done) !== JSON.stringify(["P001","P002"])) {
  throw new Error("unexpected progress: "+JSON.stringify(progress));
}
if (progress.current !== null) throw new Error("current plan not cleared");

const exclude = fs.readFileSync(path.join(repoDir, ".git", "info", "exclude"), "utf8");
if (!exclude.split(/\r?\n/).includes("/plans/")) throw new Error("driver did not self-ignore workflow state locally");
if (fs.existsSync(path.join(repoDir, ".gitignore"))) throw new Error("driver mutated repository .gitignore");

const invocations = fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const models = invocations.map(args => {
  const i=args.indexOf("--model"); return i>=0?args[i+1]:"";
});
if (models.filter(x=>x==="@builder").length < 2) throw new Error("builders were not invoked directly");
if (!models.includes("@builder_retry")) throw new Error("failed attempt did not route directly to @builder_retry");
for (const args of invocations) {
  if (!args.includes("--mode") || !args.includes("json") || !args.includes("--no-session")) throw new Error("worker is not ephemeral JSON OMP");
  const ci=args.indexOf("--config");
  if (ci<0 || !String(args[ci+1] || "").endsWith("dev-workflow.yml")) throw new Error("worker did not use isolated workflow config overlay");
  const ti=args.indexOf("--tools");
  if (ti<0 || !args[ti+1].split(",").includes("task") || !args[ti+1].split(",").includes("hub")) {
    throw new Error("worker lost OMP task/hub delegation");
  }
}
if (!notifications.some(n=>String(n.message).includes("Build complete"))) throw new Error("build completion not reported");

const messages = execFileSync("git", ["log", "--format=%s", base+"..HEAD"], { cwd: repoDir, encoding:"utf8" }).trim().split("\n");
if (messages.length !== 2) throw new Error("expected exactly two implementation commits");
if (messages.some(m=>!/^[a-z][a-z0-9-]*(\([^)]+\))?!?: .+/.test(m))) throw new Error("non-conventional commit found");

fs.rmSync(tmp, { recursive:true, force:true });
console.log("OMP deterministic driver smoke test: PASS");
