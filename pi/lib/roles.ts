import fs from "node:fs";
import { decode } from "@toon-format/toon";
export type PublicPhase = "spec" | "build" | "ship";
export type RoleName = PublicPhase | "review" | "assessor" | "explorer" | "escalated_builder";
export type AuthProvider = "openai-codex" | "openai";
export interface RoleConfig {
  authProvider: AuthProvider;
  roles: Record<RoleName, string>;
}
export interface ResolvedRole {
  provider: AuthProvider;
  model: string;
  thinking: "low" | "medium" | "high";
}

const parsed: unknown = decode(fs.readFileSync(new URL("../roles.toon", import.meta.url), "utf8"), { strict: true });
if (!parsed || typeof parsed !== "object" || !("authProvider" in parsed) || !("roles" in parsed)
  || !["openai-codex", "openai"].includes(String(parsed.authProvider)) || !parsed.roles || typeof parsed.roles !== "object") {
  throw new Error("Invalid roles.toon configuration.");
}
export const config = parsed as RoleConfig;
export const phases: readonly PublicPhase[] = ["spec", "build", "ship"];

export function role(name: RoleName): ResolvedRole {
  const match = /^openai\/([^:]+):(low|medium|high)$/.exec(config.roles[name]);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid or missing role: ${name}`);
  return { provider: config.authProvider, model: match[1], thinking: match[2] as ResolvedRole["thinking"] };
}
