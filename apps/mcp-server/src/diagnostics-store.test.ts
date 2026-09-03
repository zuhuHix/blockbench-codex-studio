import { describe, expect, it } from "vitest";

import { DiagnosticsStore } from "./diagnostics-store.js";

const base = {
  startedAtMilliseconds: Date.parse("2026-01-01T00:00:00.000Z"),
  durationMilliseconds: 4,
};

describe("DiagnosticsStore", () => {
  it("keeps tool name, duration, UUIDs, and transaction", () => {
    const store = new DiagnosticsStore();

    const entry = store.record({
      ...base,
      toolName: "commit_draft",
      success: true,
      affectedElementIds: ["11111111-1111-4111-8111-111111111111"],
      transactionId: "22222222-2222-4222-8222-222222222222",
    });

    expect(entry).toMatchObject({
      toolName: "commit_draft",
      durationMilliseconds: 4,
      success: true,
      transactionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(store.recent()).toHaveLength(1);
  });

  it("redacts failure messages and lists errors newest first", () => {
    const store = new DiagnosticsStore();
    store.record({ ...base, toolName: "first", success: false, error: "old" });
    store.record({
      ...base,
      toolName: "second",
      success: false,
      error: "Bearer abcdef1234567890abcdef1234567890abcdef rejected",
    });
    store.record({ ...base, toolName: "third", success: true });

    const errors = store.recentErrors();

    expect(errors.map((entry) => entry.toolName)).toEqual(["second", "first"]);
    expect(errors[0]?.error).not.toContain("abcdef1234567890");
  });

  it("keeps only the most recent entries", () => {
    const store = new DiagnosticsStore(2);
    for (const toolName of ["a", "b", "c"])
      store.record({ ...base, toolName, success: true });

    expect(store.recent().map((entry) => entry.toolName)).toEqual(["c", "b"]);
  });
});
