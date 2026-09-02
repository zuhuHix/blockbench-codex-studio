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

  it("retains the latest viewport until a newer capture is published", () => {
    const store = new SnapshotStore();
    const viewport = {
      mimeType: "image/png" as const,
      dataBase64: "image-data",
      width: 768,
      height: 768,
      capturedAt: "2026-09-01T09:00:00.000Z",
    };
    store.set({ viewport } as BlockbenchSnapshot);
    store.set({ capturedAt: "later" } as BlockbenchSnapshot);
    expect(store.get()?.viewport).toEqual(viewport);
  });
});
