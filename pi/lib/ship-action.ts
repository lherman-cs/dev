import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@earendil-works/pi-ai";
import { admitBuildHandoff, handoffFile, snapshotCandidate } from "./ship-handoff.ts";
import { ShipRuntime, type ShipAction, type ShipState } from "./ship-runtime.ts";
import { ShipStore } from "./ship-store.ts";

const parameters = Type.Object({ invocationId: Type.String({ minLength: 1, maxLength: 200 }), expectedRevision: Type.Integer({ minimum: 0 }), action: Type.Union([Type.Literal("start"), Type.Literal("prepare"), Type.Literal("publish"), Type.Literal("wait"), Type.Literal("audit"), Type.Literal("repair"), Type.Literal("approve"), Type.Literal("ready")]), expectedHead: Type.String({ pattern: "^[0-9a-f]{40,64}$" }) }, { additionalProperties: false });
type Args = Static<typeof parameters>;
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
/** The sole model-facing ship mutation surface. It persists completed transitions beside the handoff. */
export function shipActionTool(): ToolDefinition<typeof parameters, Record<string, never>, unknown> {
  return { name: "ship_action", label: "Ship action", description: "Advance the fixed dev-ship state machine using an exact invocation, revision, and candidate HEAD.", parameters,
    async execute(_id, args: Args, _signal, _update, ctx) {
      const store = new ShipStore(path.dirname(handoffFile(ctx.cwd)));
      const issuedInvocation = store.loadInvocation();
      if (args.invocationId !== issuedInvocation) throw new Error("Ship invocation ID was not issued by the current /dev-ship command.");
      let state = store.load()?.state;
      if (!state || state.invocationId !== issuedInvocation) {
        if (args.action !== "start" || args.expectedRevision !== 0) throw new Error("Start the command-issued ship invocation before requesting another action.");
        const handoff = admitBuildHandoff(ctx.cwd);
        if (args.expectedHead !== handoff.candidate.branch.head) throw new Error("Ship action has a stale candidate HEAD.");
        state = { invocationId: issuedInvocation, revision: 0, phase: "handoff", candidate: handoff.candidate, handoff, repairs: 0, stableKeys: state?.stableKeys ?? [] };
      }
      const runtime = new ShipRuntime(state, { persist: next => store.save({ version: 2, state: next, operations: store.load()?.operations ?? [] }), refresh: current => Promise.resolve(snapshotCandidate(ctx.cwd, current.base.ref, current.remote.name)) });
      await runtime.admit({ invocationId: args.invocationId, expectedRevision: args.expectedRevision, expectedCandidate: { ...state.candidate, branch: { ...state.candidate.branch, head: args.expectedHead } }, action: args.action });
      return result(await runtime.complete(args.action as ShipAction));
    } };
}
