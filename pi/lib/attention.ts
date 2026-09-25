import { Type } from "@earendil-works/pi-ai";

// The agent supplies meaning, never presentation markup. All fields are optional
// so existing published assessments and restored sessions remain readable.
export const attention = {
  context: Type.Optional(Type.Object({
    explanation: Type.Optional(Type.String()),
    mentalModel: Type.Optional(Type.String()),
    architecture: Type.Optional(Type.String()),
    evidence: Type.Optional(Type.Array(Type.String())),
    code: Type.Optional(Type.Array(Type.String())),
  })),
  visual: Type.Optional(Type.Union([
    Type.Object({ type: Type.Literal("option_comparison"), options: Type.Array(Type.Object({ label: Type.String(), benefit: Type.String(), cost: Type.String() }), { minItems: 2, maxItems: 3 }) }),
    Type.Object({ type: Type.Union([Type.Literal("sequence_flow"), Type.Literal("state_machine"), Type.Literal("evidence_chain"), Type.Literal("dependency_path")]), steps: Type.Array(Type.String(), { minItems: 2 }) }),
    Type.Object({ type: Type.Union([Type.Literal("architecture_delta"), Type.Literal("semantic_diff")]), before: Type.String(), after: Type.String() }),
  ])),
};
export type AttentionContext = { explanation?: string; mentalModel?: string; architecture?: string; evidence?: string[]; code?: string[] };
export type AttentionVisual =
  | { type: "option_comparison"; options: { label: string; benefit: string; cost: string }[] }
  | { type: "sequence_flow" | "state_machine" | "evidence_chain" | "dependency_path"; steps: string[] }
  | { type: "architecture_delta" | "semantic_diff"; before: string; after: string };
export type Attention = { context?: AttentionContext; visual?: AttentionVisual };
