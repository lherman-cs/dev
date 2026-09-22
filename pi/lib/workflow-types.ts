import type { WorkflowControl } from "./workflow-control.ts";

export type WorkflowPhase = "spec" | "plan" | "build" | "prepare" | "review" | "ship";
export type ShippingPhase = "build" | "prepare" | "await" | "review" | "human" | "blocked" | "done";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Project {
  root: string;
  dir: string;
}

export interface FindingSource {
  kind?: string;
  finding_key?: string;
  candidate?: string;
  evidence?: string[];
}

export interface Contract {
  version?: number;
  id: string;
  title?: string;
  goal?: string;
  requirements?: string[];
  checks: string[];
  depends_on?: string[];
  supersedes?: string | string[];
  source?: string | FindingSource;
  file: string;
}

export interface ProjectManifest {
  version?: number;
  status: string;
  base?: string;
  base_branch?: string;
  final_checks?: string[];
  [key: string]: unknown;
}

export interface ProgressState {
  version: number;
  done: string[];
  current: string | null;
  head: string;
}

export interface Candidate {
  head: string;
  base?: string;
  base_branch?: string;
  pr?: number;
  id?: string;
  url?: string;
}

export interface WorkerMetadata {
  label: string;
  task?: string;
  contract?: string;
  attempt?: number;
  predecessor?: string;
  kind?: string;
  candidate?: string;
  owner?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface DelegateOptions {
  metadata?: WorkerMetadata;
  tools?: string[];
  system?: string;
  signal?: AbortSignal;
  onStarted?: (id: string) => void;
}

export interface ReviewChoice {
  keys?: string[];
  action?: "approve" | "feedback" | "cancel" | "repairs";
  feedback?: string;
}

export interface CommandHarness {
  cwd: string;
  exec(program: string, args: string[]): Promise<ExecResult>;
}

export interface WorkflowHarness extends CommandHarness {
  readonly signal?: AbortSignal;
  readonly control?: WorkflowControl;
  lastWorkerId?: string;
  rawExec?(program: string, args: string[]): Promise<ExecResult>;
  select(title: string, choices: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  review(title: string, body: string, choices?: readonly RepairIssue[]): Promise<ReviewChoice>;
  report(message: string): void;
  checkpoint?(activity?: string): void;
  workerOutcome?(id: string | undefined, outcome: string): void;
  delegate(name: string, task: string, skill?: string, schema?: unknown, options?: DelegateOptions): Promise<unknown>;
  now?(): number;
  sleep?(milliseconds: number): Promise<void>;
}

export interface RepairIssue {
  key: string;
  title: string;
  goal: string;
  reason?: string;
  evidence?: string[];
  requirements?: string[];
  checks: string[];
}

export interface ReviewResult {
  verdict: "pass" | "repairs" | "blocked";
  summary: string;
  review_focus: string[];
  validation: string[];
  repairs: RepairIssue[];
}

export interface ReviewReport extends ReviewResult {
  head: string;
  base: string;
  pr: number;
  signature: string;
}

export interface PublishedCandidate {
  head: string;
  base: string;
  base_branch: string;
  pr: number;
  id: string;
  url: string;
}

export interface ShipState {
  version: number;
  phase: ShippingPhase;
  repair_round: number;
  verified_head: string | null;
  candidate: PublishedCandidate | null;
  approved_head: string | null;
  last_failure: string | null;
  blocked: { reason: string; resume: ShippingPhase } | null;
  rebase_base?: string;
  validation?: string[];
  feedback?: string | null;
  pending_repairs?: { issues: RepairIssue[]; candidate: Pick<PublishedCandidate, "head"> } | null;
}

export interface PullRequest {
  id: string;
  number: number;
  url: string;
  isDraft: boolean;
  state: string;
  headRefOid: string;
  baseRefOid: string;
  baseRefName: string;
}

export interface StatusCheck {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  name: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: Array<{ body: string; path?: string; line?: number; url: string; author?: { login: string } }>; pageInfo: { hasNextPage: boolean } };
}

export interface SignalData {
  headRefOid: string;
  baseRefOid: string;
  statusCheckRollup: StatusCheck[];
  comments: unknown[];
  reviews: Array<{ state: string }>;
  updatedAt: string;
  pending: boolean;
  red: boolean;
}
