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
      JSON.stringify(cube.from) !== JSON.stringify(operation.from.min) ||
      JSON.stringify(cube.to) !== JSON.stringify(operation.from.max)
    )
      throw new Error(
        `Cube ${operation.elementId} changed before the command was applied.`,
      );
    return cube;
  });
  Undo.initEdit({ elements: cubes });
  try {
    command.operations.forEach((operation, index) => {
      cubes[index]!.from = [...operation.to.min];
      cubes[index]!.to = [...operation.to.max];
    });
    Undo.finishEdit(command.label, { elements: cubes });
    Canvas.updateView({
      elements: cubes,
      element_aspects: { geometry: true, transform: true },
    });
  } catch (error) {
    Undo.cancelEdit(true);
    throw error;
  }
}
