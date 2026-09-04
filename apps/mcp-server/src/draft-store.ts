import { randomUUID } from "node:crypto";
import {
  applyDraftCommandSchema,
  setSelectionCommandSchema,
  undoCommandSchema,
  importTextureCommandSchema,
  paintTextureCommandSchema,
  captureViewsCommandSchema,
  type BridgeCommand,
  draftSummarySchema,
  type ApplyDraftCommand,
  type BlockbenchSnapshot,
  type Bounds3,
  type CubeFaceName,
  type CubeFaces,
  type CubeFaceUv,
  type DraftOperation,
  type GroupId,
  type DraftSummary,
  type ElementId,
  type OutlineNode,
  type ViewAngle,
  type TransactionId,
} from "@blockbench-codex/contracts";
import { containsBounds, dimensions } from "@blockbench-codex/geometry";
import type { JournalledDraft, JournalState } from "./crash-recovery.js";

interface DraftRecord {
  readonly projectId: string;
  summary: DraftSummary;
}

function sameVector(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, index) => value === b[index]);
}

function sameSize(a: Bounds3, b: Bounds3): boolean {
  return a.min.every(
    (_, axis) => a.max[axis]! - a.min[axis]! === b.max[axis]! - b.min[axis]!,
  );
}

/**
 * The state a cube will be in once every operation staged so far is applied.
 * Builder drafts can create a cube and then keep editing it, so operations are
 * validated against this projection rather than against the live snapshot.
 */
interface ProjectedCube {
  readonly name: string;
  readonly parentGroupId: GroupId;
  readonly bounds: Bounds3;
  readonly faces?: CubeFaces;
  /** True when the cube is created by this draft and does not exist yet. */
  readonly isNew: boolean;
}

function collectGroupIds(
  nodes: readonly OutlineNode[],
  into: Set<string>,
): Set<string> {
  for (const node of nodes) {
    if (node.type === "group") into.add(node.id);
    collectGroupIds(node.children, into);
  }
  return into;
}

interface ProjectedGroup {
  readonly name: string;
  readonly origin: readonly [number, number, number];
  readonly parentGroupId: GroupId;
  readonly isNew: boolean;
}

function findOutlineGroup(
  nodes: readonly OutlineNode[],
  groupId: string,
  parentGroupId: string,
): { node: OutlineNode; parentGroupId: string } | undefined {
  for (const node of nodes) {
    if (node.type === "group" && node.id === groupId)
      return { node, parentGroupId };
    const found = findOutlineGroup(node.children, groupId, node.id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The group as this draft will leave it, mirroring `projectCube` so a group the
 * same draft created can be re-pivoted or removed before the draft is committed.
 */
function projectGroup(
  snapshot: BlockbenchSnapshot,
  operations: readonly DraftOperation[],
  groupId: string,
): ProjectedGroup | undefined {
  const live = findOutlineGroup(snapshot.outline, groupId, "root");
  let state: ProjectedGroup | undefined =
    live === undefined
      ? undefined
      : {
          name: live.node.name,
          origin: live.node.origin ?? [0, 0, 0],
          parentGroupId: live.parentGroupId as GroupId,
          isNew: false,
        };
  for (const operation of operations) {
    if (operation.kind === "create_group" && operation.groupId === groupId) {
      state = {
        name: operation.name,
        origin: operation.origin,
        parentGroupId: operation.parentGroupId,
        isNew: true,
      };
      continue;
    }
    if (state === undefined) continue;
    if (operation.kind === "delete_group" && operation.groupId === groupId)
      state = undefined;
    else if (
      operation.kind === "set_group_origin" &&
      operation.groupId === groupId
    )
      state = { ...state, origin: operation.to };
  }
  return state;
}

/** Ids of every cube and group the draft will leave parented to `groupId`. */
function projectGroupChildren(
  snapshot: BlockbenchSnapshot,
  operations: readonly DraftOperation[],
  groupId: string,
): readonly string[] {
  const cubeIds = new Set(snapshot.elements.map((element) => element.id));
  for (const operation of operations)
    if (operation.kind === "create_cube") cubeIds.add(operation.elementId);
  const children: string[] = [];
  for (const cubeId of cubeIds)
    if (projectCube(snapshot, operations, cubeId)?.parentGroupId === groupId)
      children.push(cubeId);
  const groupIds = collectGroupIds(snapshot.outline, new Set());
  for (const operation of operations)
    if (operation.kind === "create_group") groupIds.add(operation.groupId);
  for (const candidate of groupIds)
    if (
      candidate !== groupId &&
      projectGroup(snapshot, operations, candidate)?.parentGroupId === groupId
    )
      children.push(candidate);
  return children;
}

function projectCube(
  snapshot: BlockbenchSnapshot,
  operations: readonly DraftOperation[],
  elementId: string,
): ProjectedCube | undefined {
  const existing = snapshot.elements.find(
    (element) => element.id === elementId,
  );
  let state: ProjectedCube | undefined =
    existing === undefined
      ? undefined
      : {
          name: existing.name,
          parentGroupId: existing.parentGroupId,
          bounds: existing.bounds,
          ...(existing.faces === undefined ? {} : { faces: existing.faces }),
          isNew: false,
        };
  for (const operation of operations) {
    if (
      operation.kind === "create_group" ||
      operation.kind === "delete_group" ||
      operation.kind === "set_group_origin"
    )
      continue;
    if (operation.elementId !== elementId) continue;
    if (operation.kind === "create_cube") {
      state = {
        name: operation.name,
        parentGroupId: operation.parentGroupId,
        bounds: operation.bounds,
        ...(operation.faces === undefined ? {} : { faces: operation.faces }),
        isNew: true,
      };
      continue;
    }
    if (state === undefined) continue;
    switch (operation.kind) {
      case "delete_cube":
        state = undefined;
        break;
      case "move_cube":
      case "resize_cube":
        state = { ...state, bounds: operation.to };
        break;
      case "rename_cube":
        state = { ...state, name: operation.to };
        break;
      case "reparent_cube":
        state = { ...state, parentGroupId: operation.to };
        break;
      case "set_face_uv":
        state =
          state.faces === undefined
            ? state
            : {
                ...state,
                faces: { ...state.faces, [operation.face]: operation.to },
              };
        break;
    }
  }
  return state;
}

export class DraftStore {
  readonly #drafts = new Map<string, DraftRecord>();
  readonly #commands: BridgeCommand[] = [];
  readonly #onChange: (state: JournalState) => void;

  /**
   * `onChange` receives every in-flight state change so a crash journal can
   * mirror uncommitted work to disk.
   */
  constructor(onChange: (state: JournalState) => void = () => {}) {
    this.#onChange = onChange;
  }

  /** Drafts that were begun but never committed or discarded. */
  openDrafts(): readonly JournalledDraft[] {
    return [...this.#drafts.values()].map((draft) => ({
      projectId: draft.projectId,
      summary: draft.summary,
    }));
  }

  #changed(): void {
    this.#onChange({
      drafts: this.openDrafts(),
      commands: [...this.#commands],
    });
  }

  begin(snapshot: BlockbenchSnapshot, label: string): DraftSummary {
    const summary = draftSummarySchema.parse({
      transactionId: randomUUID(),
      label,
      operations: [],
      warningCount: 0,
    });
    this.#drafts.set(summary.transactionId, {
      projectId: snapshot.project.id,
      summary,
    });
    this.#changed();
    return summary;
  }

  get(transactionId: TransactionId): DraftSummary {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    return draft.summary;
  }

  /**
   * Errors that make the staged operations unsafe to apply to `snapshot`.
   * Shared by `validate` and `commit` so a draft can never be queued through a
   * check the preview did not already run.
   */
  #inspect(
    snapshot: BlockbenchSnapshot,
    draft: DraftRecord,
  ): readonly string[] {
    const errors: string[] = [];
    if (draft.projectId !== snapshot.project.id)
      errors.push("The active Blockbench project changed during the draft.");
    const groupIds = collectGroupIds(snapshot.outline, new Set(["root"]));
    const applied: DraftOperation[] = [];
    for (const operation of draft.summary.operations) {
      if (operation.kind === "create_group") {
        if (!groupIds.has(operation.parentGroupId))
          errors.push(
            `Group ${operation.parentGroupId} no longer exists for new group ${operation.name}.`,
          );
        groupIds.add(operation.groupId);
        applied.push(operation);
        continue;
      }
      if (
        operation.kind === "delete_group" ||
        operation.kind === "set_group_origin"
      ) {
        const group = projectGroup(snapshot, applied, operation.groupId);
        if (group === undefined)
          errors.push(`Group ${operation.groupId} no longer exists.`);
        else if (group.name !== operation.name)
          errors.push(`Group ${operation.groupId} was renamed after drafting.`);
        else if (operation.kind === "delete_group") {
          if (group.parentGroupId !== operation.expectedParentGroupId)
            errors.push(`Group ${operation.groupId} changed parent groups.`);
          const children = projectGroupChildren(
            snapshot,
            applied,
            operation.groupId,
          );
          if (children.length > 0)
            errors.push(
              `Group ${operation.name} is no longer empty and will not be deleted.`,
            );
        } else if (!sameVector(group.origin, operation.from))
          errors.push(
            `Group ${operation.groupId} origin changed after drafting.`,
          );
        if (operation.kind === "delete_group")
          groupIds.delete(operation.groupId);
        applied.push(operation);
        continue;
      }
      const before = projectCube(snapshot, applied, operation.elementId);
      applied.push(operation);
      if (operation.kind === "create_cube") {
        if (before !== undefined)
          errors.push(`Cube ${operation.elementId} already exists.`);
        if (!groupIds.has(operation.parentGroupId))
          errors.push(
            `Group ${operation.parentGroupId} no longer exists for new cube ${operation.name}.`,
          );
        if (
          snapshot.project.bounds !== undefined &&
          !containsBounds(snapshot.project.bounds, operation.bounds)
        )
          errors.push(`Cube ${operation.name} would leave project bounds.`);
        continue;
      }
      if (before === undefined) {
        errors.push(`Cube ${operation.elementId} no longer exists.`);
        continue;
      }
      if (
        !before.isNew &&
        before.parentGroupId !== operation.expectedParentGroupId
      )
        errors.push(`Cube ${operation.elementId} changed parent groups.`);
      switch (operation.kind) {
        case "move_cube":
        case "resize_cube":
        case "delete_cube": {
          if (
            !sameVector(before.bounds.min, operation.from.min) ||
            !sameVector(before.bounds.max, operation.from.max)
          )
            errors.push(`Cube ${operation.elementId} changed after drafting.`);
          if (
            operation.kind === "move_cube" &&
            !sameVector(dimensions(operation.from), dimensions(operation.to))
          )
            errors.push(`Cube ${operation.elementId} would change dimensions.`);
          if (
            operation.kind !== "delete_cube" &&
            snapshot.project.bounds !== undefined &&
            !containsBounds(snapshot.project.bounds, operation.to)
          )
            errors.push(
              `Cube ${operation.elementId} would leave project bounds.`,
            );
          break;
        }
        case "rename_cube":
          if (before.name !== operation.from)
            errors.push(
              `Cube ${operation.elementId} was renamed after drafting.`,
            );
          break;
        case "reparent_cube":
          if (!groupIds.has(operation.to))
            errors.push(
              `Group ${operation.to} no longer exists for cube ${operation.elementId}.`,
            );
          break;
        case "set_face_uv":
          if (
            JSON.stringify(before.faces?.[operation.face]) !==
            JSON.stringify(operation.from)
          )
            errors.push(
              `Cube ${operation.elementId} ${operation.face} UV changed after drafting.`,
            );
          break;
      }
    }
    return errors;
  }

  validate(snapshot: BlockbenchSnapshot, transactionId: TransactionId) {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    const errors = this.#inspect(snapshot, draft);
    return {
      valid: errors.length === 0,
      transactionId,
      operationCount: draft.summary.operations.length,
      errors,
    };
  }

  #requireDraft(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
  ): DraftRecord {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    if (draft.projectId !== snapshot.project.id)
      throw new Error(
        "The active Blockbench project changed during the draft.",
      );
    return draft;
  }

  #stage(draft: DraftRecord, operation: unknown): DraftSummary {
    draft.summary = draftSummarySchema.parse({
      ...draft.summary,
      operations: [...draft.summary.operations, operation],
    });
    this.#changed();
    return draft.summary;
  }

  /**
   * The cube as this draft will leave it. Editing tools resolve targets through
   * here so a cube the same draft created is just as editable as a live one.
   */
  #requireCube(
    snapshot: BlockbenchSnapshot,
    draft: DraftRecord,
    elementId: string,
    action: string,
    allowRoot = false,
  ): ProjectedCube {
    const cube = projectCube(snapshot, draft.summary.operations, elementId);
    if (cube === undefined) throw new Error("Cube element was not found.");
    if (!allowRoot && !cube.isNew && cube.parentGroupId === "root")
      throw new Error(
        `Root-level cubes cannot be ${action} by the safe draft tool.`,
      );
    return cube;
  }

  #requireGroup(
    snapshot: BlockbenchSnapshot,
    draft: DraftRecord,
    groupId: string,
  ): GroupId {
    const groupIds = collectGroupIds(snapshot.outline, new Set(["root"]));
    for (const operation of draft.summary.operations) {
      if (operation.kind === "create_group") groupIds.add(operation.groupId);
      if (operation.kind === "delete_group") groupIds.delete(operation.groupId);
    }
    if (!groupIds.has(groupId))
      throw new Error(`Group ${groupId} was not found in the outline.`);
    return groupId as GroupId;
  }

  /** Stage a new group; returns the summary plus the id the plugin will use. */
  createGroup(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    input: {
      readonly name: string;
      readonly parentGroupId?: string;
      readonly origin?: readonly [number, number, number];
    },
  ): DraftSummary & { readonly groupId: string } {
    const draft = this.#requireDraft(snapshot, transactionId);
    const parentGroupId = this.#requireGroup(
      snapshot,
      draft,
      input.parentGroupId ?? "root",
    );
    const groupId = randomUUID();
    const summary = this.#stage(draft, {
      kind: "create_group",
      groupId,
      name: input.name,
      parentGroupId,
      origin: input.origin ?? [0, 0, 0],
    });
    return { ...summary, groupId };
  }

  #requireProjectedGroup(
    snapshot: BlockbenchSnapshot,
    draft: DraftRecord,
    groupId: string,
  ): ProjectedGroup {
    const group = projectGroup(snapshot, draft.summary.operations, groupId);
    if (group === undefined)
      throw new Error(`Group ${groupId} was not found in the outline.`);
    return group;
  }

  /**
   * Stage the removal of an empty group. Emptiness is required rather than
   * cascading, so retiring a container can never silently take cubes with it;
   * reparent or delete the children first.
   */
  deleteGroup(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    groupId: string,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    if (groupId === "root")
      throw new Error("The root group cannot be deleted.");
    const group = this.#requireProjectedGroup(snapshot, draft, groupId);
    const children = projectGroupChildren(
      snapshot,
      draft.summary.operations,
      groupId,
    );
    if (children.length > 0)
      throw new Error(
        `Group ${group.name} still holds ${children.length} child node(s); empty it before deleting.`,
      );
    return this.#stage(draft, {
      kind: "delete_group",
      groupId,
      name: group.name,
      expectedParentGroupId: group.parentGroupId,
    });
  }

  /** Stage a new pivot for an existing group. */
  setGroupOrigin(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    groupId: string,
    origin: readonly [number, number, number],
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    if (groupId === "root")
      throw new Error("The root group has no editable origin.");
    const group = this.#requireProjectedGroup(snapshot, draft, groupId);
    if (sameVector(group.origin, origin))
      throw new Error("The group already carries that origin.");
    return this.#stage(draft, {
      kind: "set_group_origin",
      groupId,
      name: group.name,
      from: group.origin,
      to: origin,
    });
  }

  /** Stage a move of an existing cube into another group. */
  reparentCube(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    parentGroupId: string,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    // Root-level cubes are allowed as the source here: pulling a stray cube
    // under a group is exactly what this tool exists to do.
    const cube = this.#requireCube(
      snapshot,
      draft,
      elementId,
      "reparented",
      true,
    );
    const to = this.#requireGroup(snapshot, draft, parentGroupId);
    if (cube.parentGroupId === to)
      throw new Error("The cube already lives in that group.");
    return this.#stage(draft, {
      kind: "reparent_cube",
      elementId,
      expectedParentGroupId: cube.parentGroupId,
      to,
    });
  }

  /** Stage a new cube; returns the summary plus the id the plugin will use. */
  createCube(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    input: {
      readonly name: string;
      readonly parentGroupId: string;
      readonly bounds: Bounds3;
      readonly rotation?: readonly [number, number, number];
      readonly faces?: CubeFaces;
    },
  ): DraftSummary & { readonly elementId: string } {
    const draft = this.#requireDraft(snapshot, transactionId);
    const parentGroupId = this.#requireGroup(
      snapshot,
      draft,
      input.parentGroupId,
    );
    if (
      snapshot.project.bounds !== undefined &&
      !containsBounds(snapshot.project.bounds, input.bounds)
    )
      throw new Error("New cube would leave project bounds.");
    const elementId = randomUUID();
    const summary = this.#stage(draft, {
      kind: "create_cube",
      elementId,
      name: input.name,
      parentGroupId,
      bounds: input.bounds,
      rotation: input.rotation ?? [0, 0, 0],
      ...(input.faces === undefined ? {} : { faces: input.faces }),
    });
    return { ...summary, elementId };
  }

  resize(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    to: Bounds3,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    const cube = this.#requireCube(snapshot, draft, elementId, "resized");
    if (
      snapshot.project.bounds !== undefined &&
      !containsBounds(snapshot.project.bounds, to)
    )
      throw new Error("Resized cube would leave project bounds.");
    return this.#stage(draft, {
      kind: "resize_cube",
      elementId,
      from: cube.bounds,
      to,
      expectedParentGroupId: cube.parentGroupId,
    });
  }

  rename(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    name: string,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    const cube = this.#requireCube(snapshot, draft, elementId, "renamed");
    if (cube.name === name)
      throw new Error("The cube already carries that name.");
    return this.#stage(draft, {
      kind: "rename_cube",
      elementId,
      from: cube.name,
      to: name,
      expectedParentGroupId: cube.parentGroupId,
    });
  }

  deleteCube(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    const cube = this.#requireCube(snapshot, draft, elementId, "deleted");
    return this.#stage(draft, {
      kind: "delete_cube",
      elementId,
      name: cube.name,
      from: cube.bounds,
      expectedParentGroupId: cube.parentGroupId,
    });
  }

  move(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    to: Bounds3,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    const cube = this.#requireCube(snapshot, draft, elementId, "moved");
    if (!sameSize(cube.bounds, to))
      throw new Error("move_cube must preserve all cube dimensions.");
    return this.#stage(draft, {
      kind: "move_cube",
      elementId,
      from: cube.bounds,
      to,
      preserveSize: true,
      expectedParentGroupId: cube.parentGroupId,
    });
  }

  setFaceUv(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    face: CubeFaceName,
    to: CubeFaceUv,
  ): DraftSummary {
    const draft = this.#requireDraft(snapshot, transactionId);
    const cube = this.#requireCube(snapshot, draft, elementId, "UV-mapped");
    const from = cube.faces?.[face];
    if (from === undefined)
      throw new Error(
        `Cube ${elementId} does not expose all six face mappings.`,
      );
    return this.#stage(draft, {
      kind: "set_face_uv",
      elementId,
      face,
      from,
      to,
      expectedParentGroupId: cube.parentGroupId,
    });
  }

  commit(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
  ): ApplyDraftCommand {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    if (draft.summary.operations.length === 0)
      throw new Error("Cannot commit an empty draft.");
    const errors = this.#inspect(snapshot, draft);
    if (errors.length > 0) throw new Error(errors.join(" "));
    const command = applyDraftCommandSchema.parse({
      commandId: randomUUID(),
      projectId: draft.projectId,
      transactionId,
      label: draft.summary.label,
      operations: draft.summary.operations,
    });
    this.#commands.push(command);
    this.#drafts.delete(transactionId);
    this.#changed();
    return command;
  }

  select(
    snapshot: BlockbenchSnapshot,
    elementIds: readonly string[],
  ): BridgeCommand {
    const uniqueIds = [...new Set(elementIds)];
    const availableIds = new Set<string>(snapshot.elements.map(({ id }) => id));
    const missing = uniqueIds.filter((id) => !availableIds.has(id));
    if (missing.length > 0)
      throw new Error(
        `Selection contains unknown elements: ${missing.join(", ")}.`,
      );
    const command = setSelectionCommandSchema.parse({
      commandId: randomUUID(),
      projectId: snapshot.project.id,
      elementIds: uniqueIds,
    });
    this.#commands.push(command);
    this.#changed();
    return command;
  }

  undo(snapshot: BlockbenchSnapshot): BridgeCommand {
    const command = undoCommandSchema.parse({
      commandId: randomUUID(),
      projectId: snapshot.project.id,
      action: "undo",
    });
    this.#commands.push(command);
    this.#changed();
    return command;
  }

  importTexture(
    snapshot: BlockbenchSnapshot,
    input: {
      readonly label: string;
      readonly absolutePath: string;
      readonly textureName: string;
      readonly applyElementIds: readonly ElementId[];
    },
  ): BridgeCommand {
    const available = new Set(snapshot.elements.map((element) => element.id));
    const applyElementIds = [...new Set(input.applyElementIds)];
    const missing = applyElementIds.filter((id) => !available.has(id));
    if (missing.length)
      throw new Error(`Texture targets unknown cubes: ${missing.join(", ")}.`);
    const command = importTextureCommandSchema.parse({
      commandId: randomUUID(),
      projectId: snapshot.project.id,
      action: "import_texture",
      ...input,
      applyElementIds,
    });
    this.#commands.push(command);
    this.#changed();
    return command;
  }

  /** Queues finished PNG bytes as one named repaint of an existing texture. */
  paintTexture(
    snapshot: BlockbenchSnapshot,
    input: {
      readonly label: string;
      readonly textureId: string;
      readonly width: number;
      readonly height: number;
      readonly dataBase64: string;
    },
  ): BridgeCommand {
    if (!snapshot.textures.some((texture) => texture.id === input.textureId))
      throw new Error(`Texture ${input.textureId} is not in the project.`);
    const command = paintTextureCommandSchema.parse({
      commandId: randomUUID(),
      projectId: snapshot.project.id,
      action: "paint_texture",
      ...input,
    });
    this.#commands.push(command);
    this.#changed();
    return command;
  }

  captureViews(
    snapshot: BlockbenchSnapshot,
    angles: readonly ViewAngle[],
    size: number,
  ): BridgeCommand & { readonly requestId: string } {
    const uniqueAngles = [...new Set(angles)];
    if (uniqueAngles.length === 0)
      throw new Error("Requested at least one camera angle.");
    const command = captureViewsCommandSchema.parse({
      commandId: randomUUID(),
      projectId: snapshot.project.id,
      action: "capture_views",
      requestId: randomUUID(),
      angles: uniqueAngles,
      size,
    });
    this.#commands.push(command);
    this.#changed();
    return command;
  }

  discard(transactionId: TransactionId): void {
    if (!this.#drafts.delete(transactionId))
      throw new Error("Draft transaction was not found.");
    this.#changed();
  }

  pending(): readonly BridgeCommand[] {
    return this.#commands;
  }

  acknowledge(commandId: string): void {
    const index = this.#commands.findIndex(
      (command) => command.commandId === commandId,
    );
    if (index >= 0) {
      this.#commands.splice(index, 1);
      this.#changed();
    }
  }
}
