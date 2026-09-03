import { describe, expect, it } from "vitest";
import {
  blockbenchSnapshotSchema,
  draftSummarySchema,
  type RefinementSessionId,
} from "@blockbench-codex/contracts";

import { RefinementStore } from "./refinement-store.js";

const group = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherGroup = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cube = "11111111-1111-4111-8111-111111111111";
const strayCube = "22222222-2222-4222-8222-222222222222";

const snapshot = blockbenchSnapshotSchema.parse({
  bridgeVersion: 1,
  project: { id: "specimen", name: "Specimen", formatId: "free" },
  selection: [],
  outline: [],
  elements: [
    {
      id: cube,
      name: "main_blob",
      parentGroupId: group,
      bounds: { min: [0, 0, 0], max: [4, 4, 4] },
      rotation: [0, 0, 0],
      visible: true,
    },
  ],
  capturedAt: new Date().toISOString(),
});

function draft(
  operations: readonly unknown[],
  transactionId = "33333333-3333-4333-8333-333333333333",
) {
  return draftSummarySchema.parse({
    transactionId,
    label: "Automatic correction",
    operations,
    warningCount: 0,
  });
}

const moveInScope = {
  kind: "move_cube",
  elementId: cube,
  from: { min: [0, 0, 0], max: [4, 4, 4] },
  to: { min: [1, 0, 0], max: [5, 4, 4] },
  preserveSize: true,
  expectedParentGroupId: group,
};

describe("RefinementStore", () => {
  it("bounds a run to its pass budget and records why it stopped", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Round off the blob", 2);
    expect(session.status).toBe("active");
    expect(store.beginPass(session.sessionId, ["front"]).pass).toBe(1);
    const second = store.beginPass(session.sessionId, ["front", "top"]);
    expect(second.remainingPasses).toBe(0);
    expect(() => store.beginPass(session.sessionId, ["front"])).toThrow(
      /limit of 2 passes/u,
    );
    const report = store.report(session.sessionId);
    expect(report.session.status).toBe("stopped");
    expect(report.session.stopReason).toBe("limit-reached");
    expect(report.session.imagesCaptured).toBe(3);
    expect(report.passes).toHaveLength(2);
  });

  it("refuses a second concurrent run", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "First goal", 1);
    expect(() => store.begin(snapshot, "Second goal", 1)).toThrow(
      /already active/u,
    );
    store.stop(session.sessionId, "satisfied");
    expect(store.begin(snapshot, "Second goal", 1).status).toBe("active");
  });

  it("allows a minimal in-scope correction", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Nudge the blob", 3, group);
    const check = store.checkDraft(
      session.sessionId,
      draft([moveInScope]),
      snapshot,
    );
    expect(check).toMatchObject({ allowed: true, operationCount: 1 });
    expect(store.recordCorrection(session.sessionId).correctionsApplied).toBe(
      1,
    );
  });

  it("rejects corrections that escape the scope group or the baseline", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Nudge the blob", 3, group);
    const check = store.checkDraft(
      session.sessionId,
      draft([
        {
          ...moveInScope,
          elementId: strayCube,
          expectedParentGroupId: otherGroup,
        },
      ]),
      snapshot,
    );
    expect(check.allowed).toBe(false);
    expect(check.violations).toHaveLength(2);
    expect(check.violations.join(" ")).toMatch(/did not exist/u);
    expect(check.violations.join(" ")).toMatch(/outside the refinement scope/u);
  });

  it("rejects a sprawling correction and an empty one", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Nudge the blob", 3);
    expect(
      store.checkDraft(session.sessionId, draft([]), snapshot).violations,
    ).toContain("An automatic correction must change something.");
    const sprawling = store.checkDraft(
      session.sessionId,
      draft(Array.from({ length: 13 }, () => moveInScope)),
      snapshot,
    );
    expect(sprawling.allowed).toBe(false);
    expect(sprawling.violations.join(" ")).toMatch(/limited to 12 operations/u);
  });

  it("rejects a correction that would resize a cube", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Nudge the blob", 3);
    const check = store.checkDraft(
      session.sessionId,
      draft([{ ...moveInScope, to: { min: [0, 0, 0], max: [8, 4, 4] } }]),
      snapshot,
    );
    expect(check.allowed).toBe(false);
    expect(check.violations.join(" ")).toMatch(/would change size/u);
  });

  it("refuses to work after the user stops the run", () => {
    const store = new RefinementStore();
    const session = store.begin(snapshot, "Nudge the blob", 3);
    const report = store.stop(session.sessionId, "stopped-by-user");
    expect(report.session.stopReason).toBe("stopped-by-user");
    expect(report.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(() => store.beginPass(session.sessionId, ["front"])).toThrow(
      /stopped already/u,
    );
    expect(
      store.checkDraft(session.sessionId, draft([moveInScope]), snapshot)
        .allowed,
    ).toBe(false);
    expect(store.activeSession()).toBeUndefined();
  });

  it("reports an unknown session plainly", () => {
    const store = new RefinementStore();
    expect(() =>
      store.report(
        "44444444-4444-4444-8444-444444444444" as RefinementSessionId,
      ),
    ).toThrow(/was not found/u);
  });
});
