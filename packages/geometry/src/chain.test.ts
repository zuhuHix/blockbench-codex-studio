import { describe, expect, it } from "vitest";
import {
  cubeElementSchema,
  type CubeElement,
} from "@blockbench-codex/contracts";

import { dimensions, overlapsOrTouches, volume } from "./bounds.js";
import { inferAnchor, layoutConnectedChain } from "./chain.js";

const groupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cubes = [
  {
    id: "anchor",
    name: "main_blob",
    parentGroupId: groupId,
    bounds: { min: [6, 1, 6], max: [10, 4, 10] },
  },
  {
    id: "near",
    name: "tentacle_west_1",
    parentGroupId: groupId,
    bounds: { min: [2, 2, 7], max: [4, 3, 8] },
  },
  {
    id: "far",
    name: "tentacle_west_2",
    parentGroupId: groupId,
    bounds: { min: [-1, 2, 7], max: [1, 3, 8] },
  },
].map((cube) => cubeElementSchema.parse(cube));

describe("connected chain layout", () => {
  it("infers the semantic main blob as anchor", () => {
    expect(inferAnchor(cubes).id).toBe("anchor");
  });

  it("connects targets in their original direction without resizing", () => {
    const layout = layoutConnectedChain(cubes);
    let previous = layout.anchor.bounds;
    for (const target of layout.targets) {
      expect(overlapsOrTouches(previous, target.bounds)).toBe(true);
      expect(dimensions(target.bounds)).toEqual(
        dimensions(target.element.bounds),
      );
      expect(volume(target.bounds)).toBe(volume(target.element.bounds));
      expect(target.bounds.max[0]).toBeLessThanOrEqual(previous.max[0]);
      previous = target.bounds;
    }
  });

  it("rejects mixed groups and out-of-envelope layouts", () => {
    const mixed: CubeElement[] = [
      ...cubes.slice(0, 2),
      {
        ...cubes[2]!,
        parentGroupId: "different" as CubeElement["parentGroupId"],
      },
    ];
    expect(() => layoutConnectedChain(mixed)).toThrow(/anchor's group/);
    expect(() =>
      layoutConnectedChain(cubes, {
        envelope: { min: [5, 0, 0], max: [16, 16, 16] },
      }),
    ).toThrow(/out of bounds/);
  });
});
