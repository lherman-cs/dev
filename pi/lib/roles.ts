import fs from "node:fs";

export type ThinkingLevel = "low" | "medium" | "high";
export type AuthProvider = "openai-codex" | "openai";
export type RoleName = "spec" | "plan" | "build" | "build_retry" | "prepare" | "review" | "ship" | "explorer";
export type RoleSelection = { provider: AuthProvider; model: string; thinking: ThinkingLevel };
type WorkflowConfig = { authProvider: AuthProvider; roles: Record<RoleName, string> };

function parseConfig(value: unknown): WorkflowConfig {
  if (!value || typeof value !== "object") throw new Error("roles.json must contain an object.");
  const candidate = value as { authProvider?: unknown; roles?: unknown };
  if (candidate.authProvider !== "openai-codex" && candidate.authProvider !== "openai") {
    throw new Error("Use authProvider openai-codex for subscription auth, or openai for API keys.");
  }
  if (!candidate.roles || typeof candidate.roles !== "object") throw new Error("roles.json must define roles.");
  return { authProvider: candidate.authProvider, roles: candidate.roles as Record<RoleName, string> };
}

export const config = parseConfig(JSON.parse(fs.readFileSync(new URL("../roles.json", import.meta.url), "utf8")) as unknown);
export const phases = ["spec", "plan", "build", "prepare", "review", "ship"] as const;

export function role(name: RoleName): RoleSelection {
  const match = /^openai\/([^:]+):(low|medium|high)$/.exec(config.roles[name] || "");
  if (!match) throw new Error(`Invalid or missing workflow role: ${name}`);
  return { provider: config.authProvider, model: match[1], thinking: match[2] as ThinkingLevel };
}
