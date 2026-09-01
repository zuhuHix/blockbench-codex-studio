import { describe, expect, it } from "vitest";
import { cubeElementSchema } from "@blockbench-codex/contracts";

import { inspectConnectivity } from "./connectivity.js";

const cube = (
  id: string,
  min: [number, number, number],
  max: [number, number, number],
) =>
  cubeElementSchema.parse({
    id,
    name: id,
    parentGroupId: "group",
    bounds: { min, max },
  });

describe("connectivity inspection", () => {
  it("reports physical chains and disconnected components", () => {
    const a = cube("a", [0, 0, 0], [2, 2, 2]);
    const b = cube("b", [2, 0, 0], [4, 2, 2]);
    const c = cube("c", [8, 0, 0], [9, 1, 1]);
    expect(inspectConnectivity([a, b])).toMatchObject({
      connected: true,
      edgeCount: 1,
    });
    expect(inspectConnectivity([a, b, c])).toMatchObject({
      connected: false,
      edgeCount: 1,
    });
    expect(inspectConnectivity([a, b, c]).components).toHaveLength(2);
  });
});
