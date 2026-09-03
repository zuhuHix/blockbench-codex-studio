import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CrashJournal } from "./crash-recovery.js";
import { DraftStore } from "./draft-store.js";

const directories: string[] = [];

function journalPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "bcs-journal-"));
  directories.push(directory);
  return join(directory, "nested", "pending-work.json");
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const draft = {
  projectId: "specimen",
  summary: {
    transactionId: "11111111-1111-4111-8111-111111111111",
    label: "Connect chain",
    operations: [],
    warningCount: 0,
  },
} as never;

const command = {
  commandId: "22222222-2222-4222-8222-222222222222",
  projectId: "specimen",
  action: "undo",
} as never;

describe("CrashJournal", () => {
  it("reports nothing after a clean shutdown", () => {
    const journal = new CrashJournal(journalPath());
    journal.record({ drafts: [draft], commands: [] });
    journal.clear();

    const report = journal.loadPreviousRun();

    expect(report.unclean).toBe(false);
    expect(report.drafts).toEqual([]);
  });

  it("reports drafts and commands left by an unclean shutdown", () => {
    const path = journalPath();
    new CrashJournal(path).record({ drafts: [draft], commands: [command] });

    const report = new CrashJournal(path).loadPreviousRun();

    expect(report.unclean).toBe(true);
    expect(report.drafts).toMatchObject([
      { transactionId: "11111111-1111-4111-8111-111111111111" },
    ]);
    expect(report.commands).toMatchObject([
      { commandId: "22222222-2222-4222-8222-222222222222", kind: "undo" },
    ]);
    expect(report.staleDiscarded).toBe(0);
  });

  it("drops entries older than the retention window", () => {
    const path = journalPath();
    const hour = 60 * 60 * 1000;
    new CrashJournal(path, hour, () => 0).record({
      drafts: [draft],
      commands: [command],
    });

    const report = new CrashJournal(
      path,
      hour,
      () => 5 * hour,
    ).loadPreviousRun();

    expect(report.drafts).toEqual([]);
    expect(report.commands).toEqual([]);
    expect(report.staleDiscarded).toBe(2);
  });

  it("still reports an unclean run when the journal is corrupt", () => {
    const path = journalPath();
    new CrashJournal(path).record({ drafts: [draft], commands: [] });
    writeFileSync(path, "{ not json", "utf8");

    expect(new CrashJournal(path).loadPreviousRun()).toMatchObject({
      unclean: true,
      drafts: [],
    });
  });

  it("mirrors uncommitted draft-store work and clears once it drains", () => {
    const path = journalPath();
    const journal = new CrashJournal(path);
    const drafts = new DraftStore((state) => {
      journal.record(state);
    });
    const snapshot = { project: { id: "specimen" }, elements: [] } as never;

    const summary = drafts.begin(snapshot, "Connect chain");
    expect(
      (JSON.parse(readFileSync(path, "utf8")) as { drafts: unknown[] }).drafts,
    ).toHaveLength(1);

    drafts.discard(summary.transactionId);
    expect(journal.loadPreviousRun().unclean).toBe(false);
  });
});
