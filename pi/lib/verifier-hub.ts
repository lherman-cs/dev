import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { StringDecoder } from "node:string_decoder";
import { WorkerHub } from "./worker-hub.ts";
import type { WorkerHistory } from "./worker-history.ts";
import type { WorkerEvent, WorkerMessage, WorkerSession, WorkerState } from "./worker-types.ts";

/** A verifier is a command runner, not an agent. Give its output a read-only Hub thread. */
export function registerVerifier(hub: WorkerHub, history: WorkerHistory | undefined, run: {
  id: string; cwd: string; commands: string[]; record: string; log: string;
}, ownerCwd: string, cancel: () => void): {
  command(command: string): void; output(chunk: Buffer): void; finish(state: WorkerState, outcome: string): void;
} {
  const metadata = { verifier: true, task: run.commands.join(" && "), cwd: run.cwd, record: run.record, log: run.log };
  const manager: SessionManager | undefined = history?.create(ownerCwd, metadata);
  const messages: WorkerMessage[] = [];
  const decoder = new StringDecoder("utf8");
  const listeners = new Set<(event: WorkerEvent) => void>();
  const session: WorkerSession = {
    messages, ...(manager ? { sessionManager: manager } : {}),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async abort() { /* Hub stop uses the verifier's cancellation action. */ },
  };
  const append = (text: string) => {
    const message: UserMessage = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
    manager?.appendMessage(message);
    listeners.forEach(listener => listener({ type: "message_end", message }));
  };
  hub.register({ id: run.id, label: `Verify · ${run.commands[0]}`, role: "Verifier", model: "command runner", thinking: "", session, metadata,
    actions: { async stop() { cancel(); } } });
  hub.update(run.id, { activity: "Checking candidate" });
  return {
    command(command) { append(`$ ${command}`); hub.update(run.id, { activity: `Running ${command}` }); },
    output(chunk) {
      // Preserve bytes in the log. The transcript is a live, searchable text projection.
      const text = decoder.write(chunk);
      if (text) append(text);
    },
    finish(state, outcome) {
      const remaining = decoder.end(); if (remaining) append(remaining);
      append(outcome);
      hub.update(run.id, { outcome, activity: outcome });
      hub.unregister(run.id, state);
    },
  };
}
