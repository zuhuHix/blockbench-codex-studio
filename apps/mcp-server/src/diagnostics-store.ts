import {
  toolLogEntrySchema,
  type ElementId,
  type ToolLogEntry,
  type TransactionId,
} from "@blockbench-codex/contracts";

/** Enough history to explain a failure without turning the panel into a log file. */
const defaultCapacity = 50;
const bearerPattern = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const tokenQueryPattern = /([?&](?:token|key|api[_-]?key)=)[^&\s]+/gi;
const longSecretPattern = /\b[A-Za-z0-9._-]{40,}\b/g;
const homePattern = /[A-Za-z]:\\Users\\[^\\/:*?"<>|\r\n]+/g;

/**
 * Removes anything that must never reach a copied diagnostics report: bearer
 * tokens, API keys, base64 image payloads, and the user's home directory.
 */
export function redactDiagnosticText(text: string): string {
  return text
    .replace(bearerPattern, "Bearer [redacted]")
    .replace(tokenQueryPattern, "$1[redacted]")
    .replace(longSecretPattern, "[redacted]")
    .replace(homePattern, "%USERPROFILE%")
    .slice(0, 500);
}

export interface ToolLogInput {
  readonly toolName: string;
  readonly startedAtMilliseconds: number;
  readonly durationMilliseconds: number;
  readonly success: boolean;
  readonly error?: string;
  readonly affectedElementIds?: readonly string[];
  readonly transactionId?: string;
}

/**
 * A bounded in-memory log of tool calls: name, duration, outcome, affected
 * UUIDs, and transaction. Prompts, images, and secrets are never stored.
 */
export class DiagnosticsStore {
  readonly #capacity: number;
  readonly #entries: ToolLogEntry[] = [];

  constructor(capacity = defaultCapacity) {
    this.#capacity = capacity;
  }

  record(input: ToolLogInput): ToolLogEntry {
    const entry = toolLogEntrySchema.parse({
      toolName: input.toolName,
      startedAt: new Date(input.startedAtMilliseconds).toISOString(),
      durationMilliseconds: Math.max(0, Math.round(input.durationMilliseconds)),
      success: input.success,
      ...(input.error === undefined || input.error === ""
        ? {}
        : { error: redactDiagnosticText(input.error) }),
      affectedElementIds: [...(input.affectedElementIds ?? [])] as ElementId[],
      ...(input.transactionId === undefined
        ? {}
        : { transactionId: input.transactionId as TransactionId }),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.#capacity)
      this.#entries.splice(0, this.#entries.length - this.#capacity);
    return entry;
  }

  /** Newest first, so the panel shows the most recent activity at the top. */
  recent(limit = 20): readonly ToolLogEntry[] {
    return [...this.#entries].reverse().slice(0, limit);
  }

  recentErrors(limit = 10): readonly ToolLogEntry[] {
    return [...this.#entries]
      .reverse()
      .filter((entry) => !entry.success)
      .slice(0, limit);
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
