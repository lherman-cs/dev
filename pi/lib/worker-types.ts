import type { AgentSessionEvent, SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent, ThinkingContent, ToolCall, Usage } from "@earendil-works/pi-ai";

export type WorkerState = "starting" | "working" | "aborting" | "completed" | "failed" | "aborted" | "interrupted";
export type DeliveryMode = "steer" | "followUp";
export type DeliveryStatus = "sending" | "queued" | "delivered" | "failed" | "cancelled";

export type WorkerMessage = Extract<AgentSessionEvent, { type: "message_start" }>["message"];
type ContentOf<Message> = Message extends { content: infer Content } ? Content : never;
export type WorkerContent = ContentOf<WorkerMessage>;
export type MessagePart = TextContent | ThinkingContent | ToolCall | ImageContent;
export type TextPart = Extract<MessagePart, { type: "text" }>;
export type ToolCallPart = Extract<MessagePart, { type: "toolCall" }>;
export interface WorkerContextUsage { tokens: number; percent: number | null; contextWindow: number }
export type WorkerToolState = Extract<AgentSessionEvent, { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>; 
export interface WorkerStats {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  totalTokens: number | null;
  cost: number | null;
  requests: number;
  tools: number;
}
export interface WorkerDelivery {
  id: string;
  text: string;
  mode: DeliveryMode;
  status: DeliveryStatus;
  at: number;
  deliveredAt?: number;
  error?: string;
}
export interface QueueContents { steering: string[]; followUp: string[] }
export interface WorkerActions {
  send?(text: string, mode: DeliveryMode): Promise<void>;
  stop?(): Promise<void>;
  cancelQueued?(): QueueContents | Promise<QueueContents>;
}
export interface WorkerSession {
  messages: readonly WorkerMessage[];
  sessionFile?: string;
  sessionManager?: SessionManager;
  isStreaming?: boolean;
  pendingMessageCount?: number;
  model?: { id: string; provider: string };
  thinkingLevel?: string;
  extensionRunner?: { emit(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown> };
  subscribe(listener: (event: WorkerEvent) => void): () => void;
  getContextUsage?(): WorkerContextUsage | undefined;
  getToolDefinition?(name: string): ToolDefinition | undefined;
  steer?(text: string): Promise<void>;
  followUp?(text: string): Promise<void>;
  prompt?(text: string, options?: { streamingBehavior?: DeliveryMode; expandPromptTemplates?: boolean; source?: "extension" }): Promise<void>;
  clearQueue?(): QueueContents;
  abort(): Promise<void>;
  abortCompaction?(): void;
  bindExtensions?(options: { mode: "json" }): Promise<void>;
  dispose?(): void;
}
export type ToolExecutionEvent = WorkerToolState;
export type WorkerEvent = AgentSessionEvent;

export interface WorkerRecord {
  id: string;
  label: string;
  role: string;
  model: string;
  thinking: string;
  session: WorkerSession | undefined;
  metadata: Record<string, unknown>;
  actions: WorkerActions | undefined;
  state: WorkerState;
  activity: string;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  messages: WorkerMessage[] | undefined;
  stats: WorkerStats;
  context: WorkerContextUsage | undefined;
  partial: WorkerMessage | undefined;
  tools: Map<string, WorkerToolState>;
  deliveries: WorkerDelivery[];
  draft: string;
  savedDraft?: string;
  version: number;
  unread: boolean;
  closed: boolean;
  accepting?: boolean;
  seen: WeakSet<object>;
  file: string | undefined;
  queue?: { steering: number; followUp: number };
  outcome?: string;
  storageError?: string;
  unsubscribe: (() => void) | undefined;
}
export type WorkerPatch = Partial<Pick<WorkerRecord, "label" | "metadata" | "state" | "activity" | "accepting" | "outcome" | "context">>;
export interface RegisterWorker {
  id: string;
  label?: string;
  role: string;
  model: string;
  thinking: string;
  session: WorkerSession;
  metadata?: Record<string, unknown>;
  actions?: WorkerActions;
}
export interface PersistedWorker extends Omit<WorkerRecord, "session" | "actions" | "tools" | "seen" | "unsubscribe"> {}
export interface WorkerHistoryStore {
  saveMetadata(record: WorkerRecord): void;
  saveDraft(record: WorkerRecord, text: string): void;
  load(record: WorkerRecord): WorkerMessage[];
}
export interface HubQuestion<T = unknown, C = unknown> {
  id: string;
  ownerId: string;
  title: string;
  answering: boolean;
  cancel(): void;
  answer(ctx: C): Promise<void>;
}
