import { describe, expect, it } from "vitest";
import { serializeFace } from "./snapshot.js";

describe("Blockbench face serialization", () => {
  it("treats Blockbench's false texture sentinel as untextured", () => {
    expect(
      serializeFace({
        texture: false,
        uv: [0, 0, 1, 1],
        enabled: true,
      }),
    ).toEqual({
      textureId: null,
      uv: [0, 0, 1, 1],
      rotation: 0,
      enabled: false,
    });
  });

  it("preserves assigned texture IDs, flipped UVs, and rotations", () => {
    expect(
      serializeFace({
        texture: 2,
        uv: [8, 4, 2, 10],
        rotation: 270,
      }),
    ).toEqual({
      textureId: "2",
      uv: [8, 4, 2, 10],
      rotation: 270,
      enabled: true,
    });
  });
});
