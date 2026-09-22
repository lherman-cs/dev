import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { shipArtifacts } from "./ship-artifacts.ts";

const parameters = Type.Object({ specPath: Type.String({ minLength: 1 }), planPath: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export function shipArtifactsTool(): ToolDefinition<typeof parameters> {
  return { name: "ship_artifacts", label: "Approved artifacts", description: "Read approved artifact paths and hashes in this repository; does not verify candidate scope or authorize shipping.", parameters,
    async execute(_id, args, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: JSON.stringify(shipArtifacts(ctx.cwd, args.specPath, args.planPath)) }], details: {} };
    } };
}
