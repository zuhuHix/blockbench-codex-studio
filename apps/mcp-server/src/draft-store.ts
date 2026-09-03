import { randomUUID } from "node:crypto";
import {
  applyDraftCommandSchema,
  setSelectionCommandSchema,
  undoCommandSchema,
  importTextureCommandSchema,
  captureViewsCommandSchema,
  type BridgeCommand,
  draftSummarySchema,
  type ApplyDraftCommand,
  type BlockbenchSnapshot,
  type Bounds3,
  type CubeFaceName,
  type CubeFaceUv,
  type DraftSummary,
  type ElementId,
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

  validate(snapshot: BlockbenchSnapshot, transactionId: TransactionId) {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    const errors: string[] = [];
    if (draft.projectId !== snapshot.project.id)
      errors.push("The active Blockbench project changed during the draft.");
    for (const operation of draft.summary.operations) {
      const current = snapshot.elements.find(
        (element) => element.id === operation.elementId,
      );
      if (current === undefined) {
        errors.push(`Cube ${operation.elementId} no longer exists.`);
        continue;
      }
      if (current.parentGroupId !== operation.expectedParentGroupId)
        errors.push(`Cube ${operation.elementId} changed parent groups.`);
      if (operation.kind === "move_cube") {
        if (
          !sameVector(current.bounds.min, operation.from.min) ||
          !sameVector(current.bounds.max, operation.from.max)
        )
          errors.push(`Cube ${operation.elementId} changed after drafting.`);
        if (!sameVector(dimensions(operation.from), dimensions(operation.to)))
          errors.push(`Cube ${operation.elementId} would change dimensions.`);
        if (
          snapshot.project.bounds !== undefined &&
          !containsBounds(snapshot.project.bounds, operation.to)
        )
          errors.push(
            `Cube ${operation.elementId} would leave project bounds.`,
          );
      } else if (
        JSON.stringify(current.faces?.[operation.face]) !==
        JSON.stringify(operation.from)
      )
        errors.push(
          `Cube ${operation.elementId} ${operation.face} UV changed after drafting.`,
        );
    }
    return {
      valid: errors.length === 0,
      transactionId,
      operationCount: draft.summary.operations.length,
      errors,
    };
  }

  move(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    to: Bounds3,
  ): DraftSummary {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    if (draft.projectId !== snapshot.project.id)
      throw new Error(
        "The active Blockbench project changed during the draft.",
      );
    const element = snapshot.elements.find(
      (candidate) => candidate.id === elementId,
    );
    if (element === undefined) throw new Error("Cube element was not found.");
    if (element.parentGroupId === "root")
      throw new Error(
        "Root-level cubes cannot be moved by the safe draft tool.",
      );
    if (!sameSize(element.bounds, to))
      throw new Error("move_cube must preserve all cube dimensions.");
    if (
      draft.summary.operations.some(
        (operation) => operation.elementId === element.id,
      )
    )
      throw new Error(
        "This draft already contains an operation for that cube.",
      );
    draft.summary = draftSummarySchema.parse({
      ...draft.summary,
      operations: [
        ...draft.summary.operations,
        {
          kind: "move_cube",
          elementId: element.id,
          from: element.bounds,
          to,
          preserveSize: true,
          expectedParentGroupId: element.parentGroupId,
        },
      ],
    });
    this.#changed();
    return draft.summary;
  }

  setFaceUv(
    snapshot: BlockbenchSnapshot,
    transactionId: TransactionId,
    elementId: string,
    face: CubeFaceName,
    to: CubeFaceUv,
  ): DraftSummary {
    const draft = this.#drafts.get(transactionId);
    if (draft === undefined)
      throw new Error("Draft transaction was not found.");
    if (draft.projectId !== snapshot.project.id)
      throw new Error(
        "The active Blockbench project changed during the draft.",
      );
    const element = snapshot.elements.find(
      (candidate) => candidate.id === elementId,
    );
    if (element === undefined) throw new Error("Cube element was not found.");
    if (element.parentGroupId === "root")
      throw new Error(
        "Root-level cubes cannot be UV-mapped by the safe draft tool.",
      );
    const from = element.faces?.[face];
    if (from === undefined)
      throw new Error(
        `Cube ${elementId} does not expose all six face mappings.`,
      );
    if (
      draft.summary.operations.some(
        (operation) =>
          operation.kind === "set_face_uv" &&
          operation.elementId === element.id &&
          operation.face === face,
      )
    )
      throw new Error(
        "This draft already contains an operation for that cube face.",
      );
    draft.summary = draftSummarySchema.parse({
      ...draft.summary,
      operations: [
        ...draft.summary.operations,
        {
          kind: "set_face_uv",
          elementId: element.id,
          face,
          from,
          to,
          expectedParentGroupId: element.parentGroupId,
        },
      ],
    });
    this.#changed();
    return draft.summary;
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
    const validation = this.validate(snapshot, transactionId);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    for (const operation of draft.summary.operations) {
      const current = snapshot.elements.find(
        (element) => element.id === operation.elementId,
      );
      if (
        current === undefined ||
        current.parentGroupId !== operation.expectedParentGroupId ||
        (operation.kind === "move_cube"
          ? !sameVector(current.bounds.min, operation.from.min) ||
            !sameVector(current.bounds.max, operation.from.max)
          : JSON.stringify(current.faces?.[operation.face]) !==
            JSON.stringify(operation.from))
      )
        throw new Error(
          `Cube ${operation.elementId} changed after the draft began.`,
        );
    }
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
