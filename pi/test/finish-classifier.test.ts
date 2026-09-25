import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { assessorBackend, classifierInstruction, type StoppingReport } from "../lib/finish-classifier.ts";

const reports: Array<[StoppingReport, string]> = [
  [{ remaining: null, nextAction: null, dependency: { kind: "none" }, complete: true }, "COMPLETE"],
  [{ remaining: "Repair failed check", nextAction: "Fix fixture", dependency: { kind: "none" }, complete: false }, "CONTINUE"],
  [{ remaining: "Await approval", nextAction: null, dependency: { kind: "human", detail: "Explicit approval required" }, complete: false }, "WAIT"],
  [{ remaining: "unknown", nextAction: null, dependency: { kind: "unknown", detail: "Clarify work" }, complete: false }, "WAIT"],
];

test("one assessor request uses only the compact report, no tools or task context", async () => {
  const requests: Array<{ systemPrompt: string; messages: Array<{ content: Array<{ text: string }> }>; tools: unknown[] }> = [];
  const options: Array<{ maxTokens: number; maxRetries: number; toolChoice: string }> = [];
  const ctx = { modelRegistry: {
    find: () => ({ contextWindow: 8000 }),
    streamSimple: (_model: unknown, request: typeof requests[number], config: typeof options[number]) => {
      requests.push(request); options.push(config);
      const payload = JSON.parse(request.messages[0]!.content[0]!.text) as StoppingReport;
      const answer = reports.find(([r]) => r.remaining === payload.remaining)?.[1];
      return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: answer }] }) };
    },
  } } as unknown as ExtensionContext;
  const backend = assessorBackend(ctx);
  for (const [report, expected] of reports) {
    await backend.checkFit(report);
    assert.equal(await backend.classify(report, new AbortController().signal), expected);
  }
  assert.equal(requests.length, 4);
  assert.match(classifierInstruction, /CONTINUE, WAIT, or COMPLETE/);
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i]!;
    assert.equal(request.systemPrompt, classifierInstruction);
    assert.deepEqual(request.tools, []);
    assert.equal(request.messages.length, 1);
    assert.deepEqual(JSON.parse(request.messages[0]!.content[0]!.text), reports[i]![0]);
    assert.equal(options[i]!.toolChoice, "none"); assert.equal(options[i]!.maxRetries, 0);
    assert.ok(options[i]!.maxTokens <= 128);
  }
});

test("assessor rejects a report beyond configured context before inference", async () => {
  const backend = assessorBackend({ modelRegistry: { find: () => ({ contextWindow: 200 }) } } as unknown as ExtensionContext);
  await assert.rejects(backend.checkFit(reports[0]![0]), /context budget/);
});
