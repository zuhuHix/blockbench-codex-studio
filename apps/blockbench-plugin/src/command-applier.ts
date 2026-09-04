import type {
  BridgeCommand,
  DraftOperation,
} from "@blockbench-codex/contracts";
import { serializeFace } from "./snapshot.js";

/** Operations that add or remove outliner nodes rather than edit one in place. */
function isStructural(operation: DraftOperation): boolean {
  return (
    operation.kind === "create_cube" ||
    operation.kind === "create_group" ||
    operation.kind === "delete_cube" ||
    operation.kind === "delete_group" ||
    operation.kind === "reparent_cube"
  );
}

function findGroup(groupId: string): BlockbenchNode {
  const group = Group.all.find((candidate) => candidate.uuid === groupId);
  if (group === undefined) throw new Error(`Group ${groupId} is unavailable.`);
  return group;
}

function findCube(elementId: string): BlockbenchNode {
  const cube = Cube.all.find((candidate) => candidate.uuid === elementId);
  if (cube?.from === undefined || cube.to === undefined)
    throw new Error(`Cube ${elementId} is unavailable.`);
  return cube;
}

function parentIdOf(node: BlockbenchNode): string {
  return node.parent === undefined || node.parent === "root"
    ? "root"
    : node.parent.uuid;
}

/**
 * Confirms the cube still looks exactly as it did when the draft was staged, so
 * a stale command fails loudly instead of overwriting newer hand edits.
 */
function checkUnchanged(cube: BlockbenchNode, operation: DraftOperation): void {
  if (operation.kind === "create_cube" || operation.kind === "create_group")
    return;
  if (
    operation.kind === "delete_group" ||
    operation.kind === "set_group_origin"
  ) {
    if (cube.name !== operation.name)
      throw new Error(
        `Group ${operation.groupId} changed before the command was applied.`,
      );
    if (operation.kind === "delete_group") {
      if (parentIdOf(cube) !== operation.expectedParentGroupId)
        throw new Error(
          `Group ${operation.groupId} changed before the command was applied.`,
        );
      if ((cube.children ?? []).length > 0)
        throw new Error(
          `Group ${operation.name} is no longer empty and will not be deleted.`,
        );
    } else if (
      JSON.stringify(cube.origin ?? [0, 0, 0]) !==
      JSON.stringify(operation.from)
    )
      throw new Error(
        `Group ${operation.groupId} changed before the command was applied.`,
      );
    return;
  }
  if (parentIdOf(cube) !== operation.expectedParentGroupId)
    throw new Error(
      `Cube ${operation.elementId} changed before the command was applied.`,
    );
  if (operation.kind === "reparent_cube") return;
  const stale =
    operation.kind === "set_face_uv"
      ? JSON.stringify(
          cube.faces?.[operation.face] === undefined
            ? undefined
            : serializeFace(cube.faces[operation.face]),
        ) !== JSON.stringify(operation.from)
      : operation.kind === "rename_cube"
        ? cube.name !== operation.from
        : JSON.stringify(cube.from) !== JSON.stringify(operation.from.min) ||
          JSON.stringify(cube.to) !== JSON.stringify(operation.from.max);
  if (stale)
    throw new Error(
      `Cube ${operation.elementId} changed before the command was applied.`,
    );
}

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
  if ("action" in command && command.action === "paint_texture") {
    const texture = Texture.all.find(
      (candidate) => candidate.uuid === command.textureId,
    );
    if (texture === undefined)
      throw new Error(`Texture ${command.textureId} is unavailable.`);
    Undo.initEdit({ textures: [texture], bitmap: true });
    try {
      texture.fromDataURL(`data:image/png;base64,${command.dataBase64}`);
      texture.updateChangesAfterEdit?.();
      Undo.finishEdit(command.label, { textures: [texture], bitmap: true });
    } catch (error) {
      Undo.cancelEdit(true);
      throw error;
    }
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

  // Cubes the draft creates do not exist yet, so only pre-existing targets are
  // resolved and drift-checked up front; created nodes join `nodes` as they are
  // built and stay addressable by the same UUID the draft handed out.
  const structural = command.operations.some(isStructural);
  const nodes = new Map<string, BlockbenchNode>();
  const pending = new Set(
    command.operations.flatMap((operation) =>
      operation.kind === "create_cube" ? [operation.elementId] : [],
    ),
  );
  for (const operation of command.operations) {
    if (operation.kind === "create_group" || operation.kind === "create_cube")
      continue;
    // Group ops address a group the draft did not create, so they resolve
    // against Group.all rather than the cube lookup.
    if (
      operation.kind === "delete_group" ||
      operation.kind === "set_group_origin"
    ) {
      if (nodes.has(operation.groupId)) continue;
      const group = findGroup(operation.groupId);
      checkUnchanged(group, operation);
      nodes.set(operation.groupId, group);
      continue;
    }
    if (pending.has(operation.elementId) || nodes.has(operation.elementId))
      continue;
    const cube = findCube(operation.elementId);
    checkUnchanged(cube, operation);
    nodes.set(operation.elementId, cube);
  }

  const existing = [...nodes.values()].filter((node) => node.type !== "group");
  const touched = new Set(existing);
  Undo.initEdit({
    elements: existing,
    ...(structural ? { outliner: true, selection: true } : {}),
  });
  try {
    for (const operation of command.operations) {
      if (operation.kind === "create_group") {
        const group = new Group(
          { name: operation.name, origin: operation.origin },
          operation.groupId,
        );
        group.addTo?.(resolveParent(nodes, operation.parentGroupId));
        group.init?.();
        nodes.set(operation.groupId, group);
        continue;
      }
      if (operation.kind === "create_cube") {
        const cube = new Cube(
          {
            name: operation.name,
            from: [...operation.bounds.min],
            to: [...operation.bounds.max],
            rotation: [...operation.rotation],
            autouv: 0,
          },
          operation.elementId,
        );
        cube.addTo?.(resolveParent(nodes, operation.parentGroupId));
        cube.init?.();
        nodes.set(operation.elementId, cube);
        touched.add(cube);
        continue;
      }
      if (
        operation.kind === "delete_group" ||
        operation.kind === "set_group_origin"
      ) {
        const group = nodes.get(operation.groupId);
        if (group === undefined)
          throw new Error(`Group ${operation.groupId} is unavailable.`);
        if (operation.kind === "delete_group") {
          group.remove?.();
          nodes.delete(operation.groupId);
        } else {
          group.origin = [...operation.to];
        }
        continue;
      }
      const cube = nodes.get(operation.elementId);
      if (cube === undefined)
        throw new Error(`Cube ${operation.elementId} is unavailable.`);
      switch (operation.kind) {
        case "move_cube":
        case "resize_cube":
          cube.from = [...operation.to.min];
          cube.to = [...operation.to.max];
          break;
        case "rename_cube":
          cube.name = operation.to;
          break;
        case "reparent_cube":
          cube.addTo?.(resolveParent(nodes, operation.to));
          touched.add(cube);
          break;
        case "delete_cube":
          cube.remove?.();
          nodes.delete(operation.elementId);
          touched.delete(cube);
          break;
        case "set_face_uv": {
          const target = cube.faces?.[operation.face];
          if (target === undefined)
            throw new Error(
              `Cube ${operation.elementId} ${operation.face} face is unavailable.`,
            );
          target.uv = [...operation.to.uv];
          target.texture = operation.to.textureId;
          target.rotation = operation.to.rotation;
          target.enabled = operation.to.enabled;
          break;
        }
      }
    }
    const elements = [...touched];
    Undo.finishEdit(command.label, {
      elements,
      ...(structural ? { outliner: true, selection: true } : {}),
    });
    if (elements.length)
      Canvas.updateView({
        elements,
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

/** Groups created earlier in the same command are valid parents too. */
function resolveParent(
  nodes: ReadonlyMap<string, BlockbenchNode>,
  parentGroupId: string,
): BlockbenchNode | undefined {
  if (parentGroupId === "root") return undefined;
  const parent =
    nodes.get(parentGroupId) ??
    Group.all.find((candidate) => candidate.uuid === parentGroupId);
  if (parent === undefined)
    throw new Error(`Group ${parentGroupId} is unavailable.`);
  return parent;
}
