import fs from "node:fs";
export const config = JSON.parse(fs.readFileSync(new URL("../roles.json", import.meta.url), "utf8"));
export const phases = ["spec", "plan", "build", "prepare", "review", "ship"];
export function role(name) {
  const match = /^openai\/([^:]+):(low|medium|high)$/.exec(config.roles[name] || "");
  if (!match) throw new Error(`Invalid or missing workflow role: ${name}`);
  if (!["openai-codex", "openai"].includes(config.authProvider)) throw new Error("Use authProvider openai-codex for subscription auth, or openai for API keys.");
  return { provider: config.authProvider, model: match[1], thinking: match[2] };
}
