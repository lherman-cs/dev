import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@earendil-works/pi-ai";
import { admitBuildHandoff, handoffFile, snapshotCandidate } from "./ship-handoff.ts";
import { ShipRuntime, type ShipAction, type ShipState } from "./ship-runtime.ts";

const parameters = Type.Object({ invocationId: Type.String({ minLength: 1, maxLength: 200 }), expectedRevision: Type.Integer({ minimum: 0 }), action: Type.Union([Type.Literal("start"), Type.Literal("prepare"), Type.Literal("publish"), Type.Literal("wait"), Type.Literal("audit"), Type.Literal("repair"), Type.Literal("approve"), Type.Literal("ready")]), expectedHead: Type.String({ pattern: "^[0-9a-f]{40,64}$" }) }, { additionalProperties: false });
type Args = Static<typeof parameters>;
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
const stateFile = (cwd: string) => path.join(path.dirname(handoffFile(cwd)), "state.json");
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${process.pid}.${crypto.randomUUID()}`; fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); }
function load(cwd: string): ShipState | undefined { try { return JSON.parse(fs.readFileSync(stateFile(cwd), "utf8")) as ShipState; } catch { return undefined; } }
/** The sole model-facing ship mutation surface. It persists completed transitions beside the handoff. */
export function shipActionTool(): ToolDefinition<typeof parameters, Record<string, never>, unknown> {
  return { name: "ship_action", label: "Ship action", description: "Advance the fixed dev-ship state machine using an exact invocation, revision, and candidate HEAD.", parameters,
    async execute(_id, args: Args, _signal, _update, ctx) {
      let state = load(ctx.cwd);
      if (!state) {
        if (args.action !== "start" || args.expectedRevision !== 0) throw new Error("Start a ship invocation before requesting another action.");
        const handoff = admitBuildHandoff(ctx.cwd);
        if (args.expectedHead !== handoff.candidate.branch.head) throw new Error("Ship action has a stale candidate HEAD.");
        state = { invocationId: args.invocationId, revision: 0, phase: "handoff", candidate: handoff.candidate, handoff, repairs: 0, stableKeys: [] };
      }
      const runtime = new ShipRuntime(state, { persist: next => write(stateFile(ctx.cwd), next), refresh: current => Promise.resolve(snapshotCandidate(ctx.cwd, current.base.ref, current.remote.name)) });
      await runtime.admit({ invocationId: args.invocationId, expectedRevision: args.expectedRevision, expectedCandidate: { ...state.candidate, branch: { ...state.candidate.branch, head: args.expectedHead } }, action: args.action });
      return result(await runtime.complete(args.action as ShipAction));
    } };
}
