import type { ApplyDraftCommand } from "@blockbench-codex/contracts";

export function applyCommand(command: ApplyDraftCommand): void {
  if ((Project?.uuid ?? Project?.name) !== command.projectId)
    throw new Error("Command targets a different Blockbench project.");
  const cubes = command.operations.map((operation) => {
    const cube = Cube.all.find(
      (candidate) => candidate.uuid === operation.elementId,
    );
    if (cube?.from === undefined || cube.to === undefined)
      throw new Error(`Cube ${operation.elementId} is unavailable.`);
    const parentId =
      cube.parent === undefined || cube.parent === "root"
        ? "root"
        : cube.parent.uuid;
    if (
      parentId !== operation.expectedParentGroupId ||
      (operation.kind === "move_cube"
        ? JSON.stringify(cube.from) !== JSON.stringify(operation.from.min) ||
          JSON.stringify(cube.to) !== JSON.stringify(operation.from.max)
        : JSON.stringify(
            cube.faces?.[operation.face] === undefined
              ? undefined
              : {
                  textureId:
                    cube.faces[operation.face]!.texture === null ||
                    cube.faces[operation.face]!.texture === undefined
                      ? null
                      : String(cube.faces[operation.face]!.texture),
                  uv: cube.faces[operation.face]!.uv,
                  rotation: cube.faces[operation.face]!.rotation ?? 0,
                  enabled:
                    cube.faces[operation.face]!.enabled ??
                    cube.faces[operation.face]!.texture !== null,
                },
          ) !== JSON.stringify(operation.from))
    )
      throw new Error(
        `Cube ${operation.elementId} changed before the command was applied.`,
      );
    return cube;
  });
  const uniqueCubes = [...new Set(cubes)];
  Undo.initEdit({ elements: uniqueCubes });
  try {
    command.operations.forEach((operation, index) => {
      if (operation.kind === "move_cube") {
        cubes[index]!.from = [...operation.to.min];
        cubes[index]!.to = [...operation.to.max];
      } else {
        const target = cubes[index]!.faces?.[operation.face];
        if (target === undefined)
          throw new Error(
            `Cube ${operation.elementId} ${operation.face} face is unavailable.`,
          );
        target.uv = [...operation.to.uv];
        target.texture = operation.to.textureId;
        target.rotation = operation.to.rotation;
        target.enabled = operation.to.enabled;
      }
    });
    Undo.finishEdit(command.label, { elements: uniqueCubes });
    Canvas.updateView({
      elements: uniqueCubes,
      element_aspects: {
        geometry: true,
        transform: true,
        uv: true,
        faces: true,
      },
    });
  } catch (error) {
    Undo.cancelEdit(true);
    throw error;
  }
}
