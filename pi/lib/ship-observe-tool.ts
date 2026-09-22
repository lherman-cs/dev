import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { observeShip } from "./ship-observe.ts";

const parameters = Type.Object({
  invocationId: Type.String({ minLength: 1, maxLength: 200 }),
  specPath: Type.String({ minLength: 1, maxLength: 1000 }),
  planPath: Type.String({ minLength: 1, maxLength: 1000 }),
  explicitBase: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, { additionalProperties: false });
export function shipObserveTool(loadInvocation: (cwd: string) => string): ToolDefinition<typeof parameters, Record<string, never>, unknown> {
  return { name: "ship_observe", label: "Ship observation", description: "Read approved artifacts, candidate Git diff, remote default and matching PRs without a build handoff. Scope provenance remains unverified until proven independently.", parameters,
    async execute(_id, args, _signal, _update, ctx) {
      if (args.invocationId !== loadInvocation(ctx.cwd)) throw new Error("A current /dev-ship invocation is required.");
      return { content: [{ type: "text", text: JSON.stringify(observeShip(ctx.cwd, args.specPath, args.planPath, args.explicitBase)) }], details: {} };
    } };
}
