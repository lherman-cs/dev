import { Type } from "@earendil-works/pi-ai";

const emphasis = Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("primary"), Type.Literal("warning")]));
const node = Type.Object({ id: Type.String(), label: Type.String(), sublabel: Type.Optional(Type.String()), emphasis });
const edge = Type.Object({ from: Type.String(), to: Type.String(), label: Type.Optional(Type.String()), emphasis: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("warning")])) });
const detail = Type.Object({ label: Type.Optional(Type.String()), summary: Type.String(), source: Type.Optional(Type.String()) });
const code = Type.Object({ path: Type.Optional(Type.String()), lines: Type.Optional(Type.String()), symbol: Type.Optional(Type.String()), summary: Type.String(), excerpt: Type.Optional(Type.String()) });
// Semantic publication only. Legacy payloads remain valid after restoration.
export const attention = {
  title: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  recommendationReason: Type.Optional(Type.String()),
  recommendedOptionId: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String(), summary: Type.String(), benefits: Type.Optional(Type.Array(Type.String())), costs: Type.Optional(Type.Array(Type.String())) }), { minItems: 2, maxItems: 3 })),
  context: Type.Optional(Type.Object({
    explanation: Type.Optional(Type.String()), mentalModel: Type.Optional(Type.String()), architecture: Type.Optional(Type.String()), remember: Type.Optional(Type.String()),
    evidence: Type.Optional(Type.Array(Type.Union([Type.String(), detail]))),
    code: Type.Optional(Type.Array(Type.Union([Type.String(), code]))),
  })),
  visual: Type.Optional(Type.Union([
    Type.Object({ type: Type.Literal("option_comparison"), options: Type.Array(Type.Object({ id: Type.Optional(Type.String()), label: Type.String(), summary: Type.Optional(Type.String()), benefit: Type.Optional(Type.String()), cost: Type.Optional(Type.String()), benefits: Type.Optional(Type.Array(Type.String())), costs: Type.Optional(Type.Array(Type.String())), recommended: Type.Optional(Type.Boolean()) }), { minItems: 2, maxItems: 3 }) }),
    Type.Object({ type: Type.Union([Type.Literal("sequence_flow"), Type.Literal("dependency_path")]), nodes: Type.Array(node, { minItems: 2, maxItems: 7 }), edges: Type.Array(edge) }),
    Type.Object({ type: Type.Literal("architecture_graph"), nodes: Type.Array(Type.Object({ ...node.properties, group: Type.Optional(Type.String()) }), { minItems: 2, maxItems: 7 }), edges: Type.Array(edge) }),
    Type.Object({ type: Type.Literal("state_machine"), states: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), emphasis }), { minItems: 2, maxItems: 7 }), transitions: Type.Array(edge) }),
    Type.Object({ type: Type.Literal("evidence_chain"), steps: Type.Array(Type.Object({ label: Type.String(), detail: Type.Optional(Type.String()), emphasis }), { minItems: 2, maxItems: 7 }) }),
    Type.Object({ type: Type.Union([Type.Literal("architecture_delta"), Type.Literal("semantic_diff")]), before: Type.Object({ title: Type.Optional(Type.String()), summary: Type.String(), items: Type.Optional(Type.Array(Type.String())) }), after: Type.Object({ title: Type.Optional(Type.String()), summary: Type.String(), items: Type.Optional(Type.Array(Type.String())) }) }),
    Type.Object({ type: Type.Union([Type.Literal("sequence_flow"), Type.Literal("state_machine"), Type.Literal("evidence_chain"), Type.Literal("dependency_path")]), steps: Type.Array(Type.String(), { minItems: 2 }) }),
    Type.Object({ type: Type.Union([Type.Literal("architecture_delta"), Type.Literal("semantic_diff")]), before: Type.String(), after: Type.String() }),
  ])),
};
export type EvidenceItem = string | { label?: string; summary: string; source?: string };
export type CodeItem = string | { path?: string; lines?: string; symbol?: string; summary: string; excerpt?: string };
export type AttentionContext = { explanation?: string; mentalModel?: string; architecture?: string; remember?: string; evidence?: EvidenceItem[]; code?: CodeItem[] };
export type DecisionOption = { id: string; label: string; summary: string; benefits?: string[]; costs?: string[] };
export type VisualNode = { id: string; label: string; sublabel?: string; group?: string; emphasis?: "normal" | "primary" | "warning" };
export type VisualEdge = { from: string; to: string; label?: string; emphasis?: "normal" | "warning" };
export type AttentionVisual =
  | { type: "option_comparison"; options: { id?: string; label: string; summary?: string; benefit?: string; cost?: string; benefits?: string[]; costs?: string[]; recommended?: boolean }[] }
  | { type: "sequence_flow" | "dependency_path"; nodes: VisualNode[]; edges: VisualEdge[] }
  | { type: "architecture_graph"; nodes: VisualNode[]; edges: VisualEdge[] }
  | { type: "state_machine"; states: { id: string; label: string; emphasis?: VisualNode["emphasis"] }[]; transitions: VisualEdge[] }
  | { type: "evidence_chain"; steps: ({ label: string; detail?: string; emphasis?: VisualNode["emphasis"] } | string)[] }
  | { type: "sequence_flow" | "state_machine" | "evidence_chain" | "dependency_path"; steps: string[] }
  | { type: "architecture_delta" | "semantic_diff"; before: string | { title?: string; summary: string; items?: string[] }; after: string | { title?: string; summary: string; items?: string[] } };
export type Attention = { title?: string; summary?: string; recommendationReason?: string; recommendedOptionId?: string; options?: DecisionOption[]; context?: AttentionContext; visual?: AttentionVisual };
