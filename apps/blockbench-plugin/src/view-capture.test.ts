import { describe, expect, it } from "vitest";

import { cameraDistance } from "./view-capture.js";

describe("cameraDistance", () => {
  it("keeps the default distance for a small model", () => {
    expect(
      cameraDistance([
        [-2, -2, -2],
        [2, 2, 2],
      ]),
    ).toBe(64);
  });

  it("pulls back far enough for a large model", () => {
    expect(
      cameraDistance([
        [-40, 0, 0],
        [10, 10, 10],
      ]),
    ).toBe(96);
  });

  it("falls back when the project is empty", () => {
    expect(cameraDistance([])).toBe(64);
  });
});
