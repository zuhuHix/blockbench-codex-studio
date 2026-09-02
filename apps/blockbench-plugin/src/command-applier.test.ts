import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDraftCommandSchema } from "@blockbench-codex/contracts";

import { applyCommand } from "./command-applier.js";

describe("Blockbench command application", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies a multi-cube draft as one named Undo edit and refreshes geometry", () => {
    const group = { uuid: "group", name: "culture_stage_2" };
    const cubes = [
      {
        uuid: "cube-a",
        name: "a",
        parent: group,
        from: [0, 0, 0],
        to: [2, 1, 1],
      },
      {
        uuid: "cube-b",
        name: "b",
        parent: group,
        from: [3, 0, 0],
        to: [5, 1, 1],
      },
    ];
    const initEdit = vi.fn();
    const finishEdit = vi.fn();
    const cancelEdit = vi.fn();
    const updateView = vi.fn();
    vi.stubGlobal("Project", { uuid: "project" });
    vi.stubGlobal("Cube", { all: cubes });
    vi.stubGlobal("Undo", { initEdit, finishEdit, cancelEdit });
    vi.stubGlobal("Canvas", { updateView });

    applyCommand(
      applyDraftCommandSchema.parse({
        commandId: "10000000-0000-4000-8000-000000000000",
        projectId: "project",
        transactionId: "20000000-0000-4000-8000-000000000000",
        label: "Connect specimen chain",
        operations: cubes.map((cube, index) => ({
          kind: "move_cube",
          elementId: cube.uuid,
          from: { min: cube.from, max: cube.to },
          to: {
            min: [index * 2, 2, 0],
            max: [index * 2 + 2, 3, 1],
          },
          preserveSize: true,
          expectedParentGroupId: "group",
        })),
      }),
    );

    expect(initEdit).toHaveBeenCalledOnce();
    expect(finishEdit).toHaveBeenCalledOnce();
    expect(finishEdit).toHaveBeenCalledWith(
      "Connect specimen chain",
      expect.any(Object),
    );
    expect(cancelEdit).not.toHaveBeenCalled();
    expect(updateView).toHaveBeenCalledOnce();
    expect(cubes.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: [0, 2, 0], to: [2, 3, 1] },
      { from: [2, 2, 0], to: [4, 3, 1] },
    ]);
  });
});
