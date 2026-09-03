import type { BridgeCommand } from "@blockbench-codex/contracts";
import { serializeFace } from "./snapshot.js";

export function applyCommand(command: BridgeCommand): void {
  if ((Project?.uuid ?? Project?.name) !== command.projectId)
    throw new Error("Command targets a different Blockbench project.");
  if ("action" in command && command.action === "capture_views")
    throw new Error(
      "Multi-view capture is handled by the view capture module, not the applier.",
    );
  if ("action" in command && command.action === "undo") {
    Undo.undo();
    return;
  }
  if ("action" in command && command.action === "import_texture") {
    const elements = command.applyElementIds.map((elementId) => {
      const cube = Cube.all.find((candidate) => candidate.uuid === elementId);
      if (cube === undefined)
        throw new Error(`Cube ${elementId} is unavailable for texture apply.`);
      return cube;
    });
    const beforeTextures = [...Texture.all];
    Undo.initEdit({ elements, textures: beforeTextures });
    let texture: BlockbenchTexture | undefined;
    try {
      texture = new Texture({ name: command.textureName })
        .fromPath(command.absolutePath)
        .add(false);
      for (const cube of elements)
        for (const face of Object.values(cube.faces ?? {}))
          face.texture = texture.uuid;
      texture.select?.();
      Undo.finishEdit(command.label, {
        elements,
        textures: [...Texture.all],
      });
      if (elements.length)
        Canvas.updateView({
          elements,
          element_aspects: { uv: true, faces: true },
        });
    } catch (error) {
      texture?.remove?.();
      Undo.cancelEdit(true);
      throw error;
    }
    return;
  }
  if ("elementIds" in command) {
    const selected = command.elementIds.map((elementId) => {
      const cube = Cube.all.find((candidate) => candidate.uuid === elementId);
      if (cube?.markAsSelected === undefined)
        throw new Error(`Cube ${elementId} is unavailable.`);
      return cube;
    });
    Outliner.selected.splice(0, Outliner.selected.length);
    for (const element of selected) element.markAsSelected?.();
    updateSelection();
    return;
  }
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
              : serializeFace(cube.faces[operation.face]),
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
