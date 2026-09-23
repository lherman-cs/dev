import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (file: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Record<string, any>;

test("GPT-6 compaction resolves to a 80k trigger with a 20k recent tail", () => {
  const settings = readJson("dotfiles/.pi/agent/settings.json");
  const compaction = settings.compaction as Record<string, any>;
  assert.equal(compaction.enabled, true);
  assert.equal(compaction.reserveTokens, 16384, "non-GPT-6 models keep Pi's ordinary safety reserve");
  assert.equal(compaction.keepRecentTokens, 20000);

  const manager = SettingsManager.inMemory(settings);
  for (const provider of ["openai", "openai-codex"]) {
    for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      const resolved = manager.getCompactionSettings({ provider, id } as never);
      assert.equal(resolved.reserveTokens, 192000, `${provider}/${id}`);
      assert.equal(resolved.keepRecentTokens, 20000, `${provider}/${id}`);
      assert.equal(272000 - resolved.reserveTokens, 80000, `${provider}/${id} trigger`);
    }
  }
});

test("VCC owns compaction content while Pi owns the threshold", () => {
  const config = readJson("dotfiles/.pi/agent/pi-vcc-config.json");
  assert.equal(config.overrideDefaultCompaction, true);
  assert.equal(config.smartKeepTail, true);
  assert.equal(config.continueAfterThresholdCompact, true);
  assert.equal(config.debug, false);
  assert.equal("globalThreshold" in config, false, "unsupported VCC threshold must not shadow Pi settings");
});
