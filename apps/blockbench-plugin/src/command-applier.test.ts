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

  it("applies multiple face mappings to one cube in one Undo edit", () => {
    const group = { uuid: "group", name: "culture_stage_2" };
    const original = {
      texture: "culture",
      uv: [0, 0, 2, 2],
      rotation: 0,
      enabled: true,
    };
    const cube = {
      uuid: "cube-a",
      name: "a",
      parent: group,
      from: [0, 0, 0],
      to: [2, 2, 2],
      faces: { north: { ...original }, south: { ...original } },
    };
    const initEdit = vi.fn(),
      finishEdit = vi.fn(),
      updateView = vi.fn(
        (_options: { element_aspects: { uv?: boolean; faces?: boolean } }) => {
          void _options;
        },
      );
    vi.stubGlobal("Project", { uuid: "project" });
    vi.stubGlobal("Cube", { all: [cube] });
    vi.stubGlobal("Undo", { initEdit, finishEdit, cancelEdit: vi.fn() });
    vi.stubGlobal("Canvas", { updateView });
    const from = {
      textureId: "culture",
      uv: [0, 0, 2, 2],
      rotation: 0,
      enabled: true,
    };
    applyCommand(
      applyDraftCommandSchema.parse({
        commandId: "10000000-0000-4000-8000-000000000000",
        projectId: "project",
        transactionId: "20000000-0000-4000-8000-000000000000",
        label: "Project UVs",
        operations: ["north", "south"].map((face, index) => ({
          kind: "set_face_uv",
          elementId: "cube-a",
          face,
          from,
          to: { ...from, uv: [index * 2, 2, index * 2 + 2, 4] },
          expectedParentGroupId: "group",
        })),
      }),
    );
    expect(initEdit).toHaveBeenCalledWith({ elements: [cube] });
    expect(finishEdit).toHaveBeenCalledOnce();
    expect(cube.faces.north.uv).toEqual([0, 2, 2, 4]);
    expect(cube.faces.south.uv).toEqual([2, 2, 4, 4]);
    expect(updateView.mock.calls[0]![0].element_aspects).toMatchObject({
      uv: true,
      faces: true,
    });
  });
});
