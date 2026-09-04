import { describe, expect, it } from "vitest";
import {
  blockbenchSnapshotSchema,
  type BlockbenchSnapshot,
  type TransactionId,
} from "@blockbench-codex/contracts";

import { DraftStore } from "./draft-store.js";

const STAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPARE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPTY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BLOB = "11111111-1111-4111-8111-111111111111";

const snapshot: BlockbenchSnapshot = blockbenchSnapshotSchema.parse({
  bridgeVersion: 1,
  project: {
    id: "specimen",
    name: "Specimen Chamber",
    formatId: "free",
    textureSize: { width: 32, height: 32 },
  },
  selection: [],
  outline: [
    {
      id: STAGE,
      name: "culture_stage_2",
      type: "group",
      origin: [0, 0, 0],
      children: [{ id: BLOB, name: "main_blob", type: "cube", children: [] }],
    },
    { id: SPARE, name: "spare_stage", type: "group", children: [] },
    { id: EMPTY, name: "leftover_pivot", type: "group", children: [] },
  ],
  elements: [
    {
      id: BLOB,
      name: "main_blob",
      parentGroupId: STAGE,
      bounds: { min: [6, 1, 6], max: [10, 4, 10] },
      rotation: [0, 0, 0],
      visible: true,
    },
  ],
  capturedAt: new Date().toISOString(),
});

function begin(): { store: DraftStore; transactionId: TransactionId } {
  const store = new DraftStore();
  const { transactionId } = store.begin(snapshot, "Restructure");
  return { store, transactionId };
}

describe("group structure operations", () => {
  it("stages a new origin against the origin the draft observed", () => {
    const { store, transactionId } = begin();
    const summary = store.setGroupOrigin(
      snapshot,
      transactionId,
      STAGE,
      [8, 16, 8],
    );
    expect(summary.operations).toEqual([
      {
        kind: "set_group_origin",
        groupId: STAGE,
        name: "culture_stage_2",
        from: [0, 0, 0],
        to: [8, 16, 8],
      },
    ]);
    expect(store.validate(snapshot, transactionId).valid).toBe(true);
  });

  it("treats a group without a published origin as sitting at the world origin", () => {
    const { store, transactionId } = begin();
    const summary = store.setGroupOrigin(
      snapshot,
      transactionId,
      SPARE,
      [1, 2, 3],
    );
    expect(summary.operations[0]).toMatchObject({ from: [0, 0, 0] });
  });

  it("refuses an origin the group already carries", () => {
    const { store, transactionId } = begin();
    expect(() =>
      store.setGroupOrigin(snapshot, transactionId, STAGE, [0, 0, 0]),
    ).toThrow(/already carries that origin/);
  });

  it("deletes an empty group", () => {
    const { store, transactionId } = begin();
    const summary = store.deleteGroup(snapshot, transactionId, EMPTY);
    expect(summary.operations).toEqual([
      {
        kind: "delete_group",
        groupId: EMPTY,
        name: "leftover_pivot",
        expectedParentGroupId: "root",
      },
    ]);
    expect(store.validate(snapshot, transactionId).valid).toBe(true);
  });

  it("refuses to delete a group that still holds a cube", () => {
    const { store, transactionId } = begin();
    expect(() => store.deleteGroup(snapshot, transactionId, STAGE)).toThrow(
      /still holds 1 child node/,
    );
  });

  it("refuses to delete the root group", () => {
    const { store, transactionId } = begin();
    expect(() => store.deleteGroup(snapshot, transactionId, "root")).toThrow(
      /root group cannot be deleted/,
    );
  });

  it("lets a group be emptied by reparenting and then deleted in one draft", () => {
    const { store, transactionId } = begin();
    store.reparentCube(snapshot, transactionId, BLOB, SPARE);
    const summary = store.deleteGroup(snapshot, transactionId, STAGE);
    expect(summary.operations).toEqual([
      {
        kind: "reparent_cube",
        elementId: BLOB,
        expectedParentGroupId: STAGE,
        to: SPARE,
      },
      {
        kind: "delete_group",
        groupId: STAGE,
        name: "culture_stage_2",
        expectedParentGroupId: "root",
      },
    ]);
    expect(store.validate(snapshot, transactionId).valid).toBe(true);
  });

  it("refuses to reparent a cube into the group it already lives in", () => {
    const { store, transactionId } = begin();
    expect(() =>
      store.reparentCube(snapshot, transactionId, BLOB, STAGE),
    ).toThrow(/already lives in that group/);
  });

  it("refuses to reparent into a group the same draft deleted", () => {
    const { store, transactionId } = begin();
    store.deleteGroup(snapshot, transactionId, EMPTY);
    expect(() =>
      store.reparentCube(snapshot, transactionId, BLOB, EMPTY),
    ).toThrow(/was not found in the outline/);
  });

  it("re-pivots and retires a group the same draft created", () => {
    const { store, transactionId } = begin();
    const { groupId } = store.createGroup(snapshot, transactionId, {
      name: "shell",
      origin: [0, 0, 0],
    });
    store.setGroupOrigin(snapshot, transactionId, groupId, [8, 16, 8]);
    store.deleteGroup(snapshot, transactionId, groupId);
    expect(store.validate(snapshot, transactionId).valid).toBe(true);
  });

  it("reports a group that disappeared between drafting and validation", () => {
    const { store, transactionId } = begin();
    store.setGroupOrigin(snapshot, transactionId, EMPTY, [8, 16, 8]);
    const without = blockbenchSnapshotSchema.parse({
      ...snapshot,
      outline: snapshot.outline.filter((node) => node.id !== EMPTY),
    });
    const result = store.validate(without, transactionId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`Group ${EMPTY} no longer exists.`);
  });

  it("reports a group whose origin moved after drafting", () => {
    const { store, transactionId } = begin();
    store.setGroupOrigin(snapshot, transactionId, STAGE, [8, 16, 8]);
    const moved = blockbenchSnapshotSchema.parse({
      ...snapshot,
      outline: snapshot.outline.map((node) =>
        node.id === STAGE ? { ...node, origin: [1, 1, 1] } : node,
      ),
    });
    const result = store.validate(moved, transactionId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `Group ${STAGE} origin changed after drafting.`,
    );
  });

  it("reports a group that gained a cube after the delete was staged", () => {
    const { store, transactionId } = begin();
    store.deleteGroup(snapshot, transactionId, EMPTY);
    const refilled = blockbenchSnapshotSchema.parse({
      ...snapshot,
      elements: [
        ...snapshot.elements,
        {
          id: "44444444-4444-4444-8444-444444444444",
          name: "stray",
          parentGroupId: EMPTY,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          rotation: [0, 0, 0],
          visible: true,
        },
      ],
    });
    const result = store.validate(refilled, transactionId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Group leftover_pivot is no longer empty and will not be deleted.",
    );
  });
});
