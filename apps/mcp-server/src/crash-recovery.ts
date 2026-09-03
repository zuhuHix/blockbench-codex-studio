import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  recoveryReportSchema,
  type BridgeCommand,
  type DraftSummary,
  type RecoveredCommand,
  type RecoveredDraft,
  type RecoveryReport,
} from "@blockbench-codex/contracts";

/** Journal entries older than this belong to a session the user has moved on from. */
const defaultRetentionMilliseconds = 24 * 60 * 60 * 1000;

export interface JournalledDraft {
  readonly projectId: string;
  readonly summary: DraftSummary;
}

export interface JournalState {
  readonly drafts: readonly JournalledDraft[];
  readonly commands: readonly BridgeCommand[];
}

interface JournalFile {
  readonly recordedAt: string;
  readonly drafts: RecoveredDraft[];
  readonly commands: RecoveredCommand[];
}

export function defaultJournalPath(): string {
  const base =
    process.env.BLOCKBENCH_CODEX_STATE_DIR ??
    (process.env.APPDATA === undefined
      ? join(tmpdir(), "blockbench-codex-studio")
      : join(process.env.APPDATA, "BlockbenchCodexStudio"));
  return join(base, "pending-work.json");
}

function commandKind(command: BridgeCommand): string {
  if ("action" in command) return command.action;
  return "transactionId" in command ? "apply_draft" : "set_selection";
}

/**
 * Records uncommitted drafts and unacknowledged bridge commands so a crash or a
 * forced restart can report exactly what was in flight. Recovered work is only
 * ever described back to the user; it is never replayed automatically.
 */
export class CrashJournal {
  readonly #path: string;
  readonly #retentionMilliseconds: number;
  readonly #now: () => number;

  constructor(
    path = defaultJournalPath(),
    retentionMilliseconds = defaultRetentionMilliseconds,
    now: () => number = Date.now,
  ) {
    this.#path = path;
    this.#retentionMilliseconds = retentionMilliseconds;
    this.#now = now;
  }

  get path(): string {
    return this.#path;
  }

  /**
   * Reads whatever the previous run left behind. A readable journal means that
   * run never shut down cleanly, because a clean shutdown removes the file.
   */
  loadPreviousRun(): RecoveryReport {
    const empty = {
      journalPath: this.#path,
      unclean: false,
      drafts: [],
      commands: [],
      staleDiscarded: 0,
    };
    if (!existsSync(this.#path)) return recoveryReportSchema.parse(empty);
    let file: JournalFile;
    try {
      file = JSON.parse(readFileSync(this.#path, "utf8")) as JournalFile;
    } catch {
      // A half-written journal tells us the run crashed but nothing more.
      return recoveryReportSchema.parse({ ...empty, unclean: true });
    }
    const cutoff = this.#now() - this.#retentionMilliseconds;
    const fresh = <T extends { readonly recordedAt: string }>(
      entries: readonly T[] | undefined,
    ) =>
      (entries ?? []).filter((entry) => Date.parse(entry.recordedAt) >= cutoff);
    const drafts = fresh(file.drafts);
    const commands = fresh(file.commands);
    const staleDiscarded =
      (file.drafts?.length ?? 0) -
      drafts.length +
      ((file.commands?.length ?? 0) - commands.length);
    const parsed = recoveryReportSchema.safeParse({
      journalPath: this.#path,
      unclean: true,
      drafts,
      commands,
      staleDiscarded,
    });
    return parsed.success
      ? parsed.data
      : recoveryReportSchema.parse({ ...empty, unclean: true });
  }

  /** Rewrites the journal. Empty state clears it, matching a clean shutdown. */
  record(state: JournalState): void {
    if (state.drafts.length === 0 && state.commands.length === 0) {
      this.clear();
      return;
    }
    const recordedAt = new Date(this.#now()).toISOString();
    const file: JournalFile = {
      recordedAt,
      drafts: state.drafts.map((draft) => ({
        transactionId: draft.summary.transactionId,
        projectId: draft.projectId,
        label: draft.summary.label,
        operationCount: draft.summary.operations.length,
        recordedAt,
      })),
      commands: state.commands.map((command) => ({
        commandId: command.commandId,
        projectId: command.projectId,
        kind: commandKind(command),
        recordedAt,
      })),
    };
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    renameSync(temporary, this.#path);
  }

  clear(): void {
    rmSync(this.#path, { force: true });
  }
}
