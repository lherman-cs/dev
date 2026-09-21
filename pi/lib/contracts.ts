import type { SessionManager } from "@earendil-works/pi-coding-agent";

export type SessionHeader = ReturnType<SessionManager["getHeader"]>;
export type SessionEntry = ReturnType<SessionManager["getEntries"]>[number];

export interface ParentSessionManager {
  getSessionFile(): string | undefined;
  getSessionDir(): string;
  getSessionId(): string;
  getCwd(): string;
  getHeader(): SessionHeader;
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  setSessionFile(path: string): void;
  branch(id: string): void;
}

export type WorkerState = "starting" | "working" | "aborting" | "completed" | "failed" | "aborted" | "interrupted";
export type DeliveryStatus = "sending" | "queued" | "delivered" | "failed" | "cancelled";

export interface DeliveryRecord {
  id?: string;
  text: string;
  status: DeliveryStatus;
  error?: string;
  at?: number;
  deliveredAt?: number;
  mode?: "steer" | "followUp";
}

export interface PersistedWorkerRecord {
  id: string;
  label?: string;
  role?: string;
  model?: string;
  thinking?: string;
  metadata?: Record<string, unknown>;
  file?: string;
  sessionFile?: string;
  startedAt?: number;
  endedAt?: number;
  state?: WorkerState;
  activity?: string;
  stats?: Record<string, unknown>;
  context?: unknown;
  outcome?: unknown;
  draft?: string;
  deliveries?: DeliveryRecord[];
  receipts?: Array<Record<string, unknown>>;
  messages?: unknown[];
}

export interface WorkerHistoryRecord extends PersistedWorkerRecord {
  file: string;
}

export interface WorkerHistoryHub {
  get(id: string): unknown;
  restore(record: PersistedWorkerRecord): void;
}

export interface WorkerHistorySession {
  sessionManager?: SessionManager;
}
