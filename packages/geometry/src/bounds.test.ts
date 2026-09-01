import { describe, expect, it } from "vitest";
import type { Bounds3 } from "@blockbench-codex/contracts";

import {
  containsBounds,
  dimensions,
  overlapsOrTouches,
  translate,
  volume,
} from "./bounds.js";

const cube: Bounds3 = { min: [1, 2, 3], max: [3, 5, 7] };

describe("axis-aligned bounds", () => {
  it("measures dimensions and volume", () => {
    expect(dimensions(cube)).toEqual([2, 3, 4]);
    expect(volume(cube)).toBe(24);
  });

  it("translates without changing dimensions or volume", () => {
    const moved = translate(cube, [5, -2, 1]);
    expect(moved).toEqual({ min: [6, 0, 4], max: [8, 3, 8] });
    expect(dimensions(moved)).toEqual(dimensions(cube));
    expect(volume(moved)).toBe(volume(cube));
  });

  it("distinguishes contact from separation", () => {
    expect(overlapsOrTouches(cube, { min: [3, 2, 3], max: [4, 3, 4] })).toBe(
      true,
    );
    expect(overlapsOrTouches(cube, { min: [3.1, 2, 3], max: [4, 3, 4] })).toBe(
      false,
    );
    expect(
      overlapsOrTouches(cube, { min: [3.1, 2, 3], max: [4, 3, 4] }, 0.1),
    ).toBe(true);
  });

  it("checks safety-envelope containment", () => {
    expect(containsBounds({ min: [0, 0, 0], max: [16, 32, 16] }, cube)).toBe(
      true,
    );
    expect(containsBounds({ min: [0, 0, 0], max: [2, 32, 16] }, cube)).toBe(
      false,
    );
  });
});
