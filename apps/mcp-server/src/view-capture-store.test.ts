import { describe, expect, it } from "vitest";
import { multiViewCaptureSchema } from "@blockbench-codex/contracts";

import { ViewCaptureStore } from "./view-capture-store.js";

const requestId = "44444444-4444-4444-8444-444444444444";

const capture = multiViewCaptureSchema.parse({
  requestId,
  projectId: "specimen",
  views: [
    {
      angle: "front",
      mimeType: "image/png",
      dataBase64: "aW1hZ2U=",
      width: 768,
      height: 768,
      capturedAt: new Date().toISOString(),
    },
  ],
  capturedAt: new Date().toISOString(),
});

describe("ViewCaptureStore", () => {
  it("resolves a waiter when the plugin posts the capture", async () => {
    const store = new ViewCaptureStore();
    const pending = store.wait(requestId, 1_000);
    store.complete(capture);
    await expect(pending).resolves.toMatchObject({ projectId: "specimen" });
  });

  it("keeps a capture that arrives before the tool awaits it", async () => {
    const store = new ViewCaptureStore();
    store.complete(capture);
    await expect(store.wait(requestId, 1_000)).resolves.toMatchObject({
      requestId,
    });
    await expect(store.wait(requestId, 20)).rejects.toThrow(/in time/u);
  });

  it("rejects when the plugin reports the command failed", async () => {
    const store = new ViewCaptureStore();
    const pending = store.wait(requestId, 1_000);
    store.fail(requestId, "Blockbench has no active preview to capture.");
    await expect(pending).rejects.toThrow(/no active preview/u);
  });

  it("rejects when Blockbench never answers", async () => {
    const store = new ViewCaptureStore();
    await expect(store.wait(requestId, 20)).rejects.toThrow(/in time/u);
  });

  it("remembers the latest capture per project", () => {
    const store = new ViewCaptureStore();
    expect(store.latest("specimen")).toBeUndefined();
    store.complete(capture);
    expect(store.latest("specimen")?.requestId).toBe(requestId);
  });
});
