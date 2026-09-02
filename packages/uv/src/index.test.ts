import { describe, expect, it } from "vitest";
import { cubeElementSchema } from "@blockbench-codex/contracts";
import {
  auditUvSeams,
  measureUvCoverage,
  normalizeFaceTexelDensity,
  packFaces,
  projectCubeFromAnchor,
} from "./index.js";

const face = {
  textureId: "culture",
  uv: [0, 0, 4, 4],
  rotation: 0,
  enabled: true,
} as const;
const faces = {
  north: face,
  south: face,
  east: face,
  west: face,
  up: face,
  down: face,
};
const anchor = cubeElementSchema.parse({
  id: "anchor",
  name: "main_blob",
  parentGroupId: "group",
  bounds: { min: [0, 0, 0], max: [4, 4, 4] },
  faces,
});
const target = cubeElementSchema.parse({
  id: "target",
  name: "arm",
  parentGroupId: "group",
  bounds: { min: [4, 0, 0], max: [6, 2, 2] },
  faces,
});

describe("UV projection and audits", () => {
  it("projects six faces from world offsets and detects repaired seams", () => {
    const projected = projectCubeFromAnchor(anchor, target);
    expect(projected.north.uv).toEqual([4, 0, 6, 2]);
    expect(projected.east.uv).toEqual([0, 0, 2, 2]);
    expect(
      auditUvSeams(anchor, [{ ...target, faces: projected }]),
    ).toMatchObject({ continuous: true, seamCount: 0 });
    expect(auditUvSeams(anchor, [target]).seamCount).toBeGreaterThan(0);
  });
  it("measures unique atlas coverage instead of double-counting overlap", () => {
    expect(
      measureUvCoverage([anchor, target], { width: 8, height: 8 }),
    ).toMatchObject({
      coveredPixels: 16,
      coveragePercent: 25,
      mappedFaceCount: 12,
    });
  });
  it("normalizes density and packs islands without changing orientation", () => {
    expect(normalizeFaceTexelDensity(target, "north", 2).uv).toEqual([
      0, 0, 4, 4,
    ]);
    expect(
      packFaces([target], { width: 32, height: 32 }, 1).get("target:north")?.uv,
    ).toEqual([1, 1, 5, 5]);
  });
});
