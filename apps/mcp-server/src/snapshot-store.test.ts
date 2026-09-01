import { describe, expect, it } from "vitest";
import type { BlockbenchSnapshot } from "@blockbench-codex/contracts";

import { SnapshotStore } from "./snapshot-store.js";

describe("SnapshotStore", () => {
  it("distinguishes connected, stale, and never-connected states", () => {
    const store = new SnapshotStore(5_000);
    expect(store.status(1_000)).toEqual({ connected: false, stale: false });
    store.set({} as BlockbenchSnapshot, 1_000);
    expect(store.status(5_999).connected).toBe(true);
    expect(store.status(6_001)).toMatchObject({
      connected: false,
      stale: true,
    });
  });
});
