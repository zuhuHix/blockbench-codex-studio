import { describe, expect, it } from "vitest";

import { bounds3Schema, toolResultSchema } from "./index.js";
import { z } from "zod";

describe("bounds3Schema", () => {
  it("accepts a positive-volume cube", () => {
    expect(bounds3Schema.parse({ min: [0, 1, 2], max: [3, 4, 5] })).toEqual({
      min: [0, 1, 2],
      max: [3, 4, 5],
    });
  });

  it("rejects zero-size and inverted axes", () => {
    expect(() =>
      bounds3Schema.parse({ min: [0, 2, 0], max: [1, 2, -1] }),
    ).toThrow();
  });
});

describe("toolResultSchema", () => {
  it("validates typed success and failure envelopes", () => {
    const schema = toolResultSchema(z.object({ connected: z.boolean() }));
    expect(schema.parse({ ok: true, data: { connected: true } }).ok).toBe(true);
    expect(
      schema.parse({
        ok: false,
        error: { code: "NOT_CONNECTED", message: "Blockbench is offline" },
      }).ok,
    ).toBe(false);
  });
});
