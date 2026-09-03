import { randomUUID } from "node:crypto";
import {
  refinementPassSchema,
  refinementReportSchema,
  refinementSessionSchema,
  type BlockbenchSnapshot,
  type DraftSummary,
  type RefinementDraftCheck,
  type RefinementPass,
  type RefinementReport,
  type RefinementSession,
  type RefinementSessionId,
  type RefinementStopReason,
  type ViewAngle,
} from "@blockbench-codex/contracts";

/** A single automatic pass may never turn into a rebuild. */
const maximumOperationsPerCorrection = 12;

interface SessionRecord {
  session: RefinementSession;
  readonly passes: RefinementPass[];
  readonly startedAtMilliseconds: number;
  stoppedAtMilliseconds?: number;
}

/**
 * Bounds automatic viewport refinement: a pass budget, a fixed element and
 * group scope, an explicit stop reason, and a resource report. Refinement is
 * off until a session is explicitly begun.
 */
export class RefinementStore {
  readonly #sessions = new Map<string, SessionRecord>();

  #require(sessionId: RefinementSessionId): SessionRecord {
    const record = this.#sessions.get(sessionId);
    if (record === undefined)
      throw new Error("Refinement session was not found.");
    return record;
  }

  begin(
    snapshot: BlockbenchSnapshot,
    goal: string,
    maxPasses: number,
    scopeGroupId?: string,
    now = Date.now(),
  ): RefinementSession {
    const active = [...this.#sessions.values()].find(
      (record) => record.session.status === "active",
    );
    if (active !== undefined)
      throw new Error(
        "Another refinement run is already active. Stop it before beginning a new one.",
      );
    const baselineElementIds = snapshot.elements.map((element) => element.id);
    if (
      scopeGroupId !== undefined &&
      !snapshot.elements.some(
        (element) => element.parentGroupId === scopeGroupId,
      )
    )
      throw new Error("The refinement scope group holds no cubes.");
    const session = refinementSessionSchema.parse({
      sessionId: randomUUID(),
      projectId: snapshot.project.id,
      goal,
      ...(scopeGroupId === undefined ? {} : { scopeGroupId }),
      baselineElementIds,
      maxPasses,
      passesUsed: 0,
      correctionsApplied: 0,
      imagesCaptured: 0,
      status: "active",
      startedAt: new Date(now).toISOString(),
    });
    this.#sessions.set(session.sessionId, {
      session,
      passes: [],
      startedAtMilliseconds: now,
    });
    return session;
  }

  get(sessionId: RefinementSessionId): RefinementSession {
    return this.#require(sessionId).session;
  }

  /** The one active run, for the panel's Stop button. */
  activeSession(): RefinementSession | undefined {
    return [...this.#sessions.values()].find(
      (record) => record.session.status === "active",
    )?.session;
  }

  /**
   * Claims the next pass. Throws once the budget is spent, stopping the run
   * with `limit-reached` so the reason is always recorded.
   */
  beginPass(
    sessionId: RefinementSessionId,
    angles: readonly ViewAngle[],
    note?: string,
    now = Date.now(),
  ): RefinementPass {
    const record = this.#require(sessionId);
    if (record.session.status !== "active")
      throw new Error(
        `Refinement stopped already (${record.session.stopReason ?? "unknown"}).`,
      );
    if (record.session.passesUsed >= record.session.maxPasses) {
      this.stop(sessionId, "limit-reached", now);
      throw new Error(
        `Refinement reached its limit of ${record.session.maxPasses} passes.`,
      );
    }
    const pass = refinementPassSchema.parse({
      pass: record.session.passesUsed + 1,
      remainingPasses: record.session.maxPasses - record.session.passesUsed - 1,
      angles: [...angles],
      ...(note === undefined ? {} : { note }),
      capturedAt: new Date(now).toISOString(),
    });
    record.passes.push(pass);
    record.session = refinementSessionSchema.parse({
      ...record.session,
      passesUsed: pass.pass,
      imagesCaptured: record.session.imagesCaptured + angles.length,
    });
    return pass;
  }

  /**
   * Checks a proposed correction against the automatic-pass rules before it can
   * be committed: in scope, on pre-existing cubes, and minimal.
   */
  checkDraft(
    sessionId: RefinementSessionId,
    draft: DraftSummary,
    snapshot: BlockbenchSnapshot,
  ): RefinementDraftCheck {
    const record = this.#require(sessionId);
    const session = record.session;
    const violations: string[] = [];
    if (session.status !== "active")
      violations.push(
        `Refinement stopped already (${session.stopReason ?? "unknown"}).`,
      );
    if (session.projectId !== snapshot.project.id)
      violations.push("The active Blockbench project changed during the run.");
    if (draft.operations.length === 0)
      violations.push("An automatic correction must change something.");
    if (draft.operations.length > maximumOperationsPerCorrection)
      violations.push(
        `An automatic correction is limited to ${maximumOperationsPerCorrection} operations.`,
      );
    const baseline = new Set(session.baselineElementIds);
    for (const operation of draft.operations) {
      if (!baseline.has(operation.elementId))
        violations.push(
          `Cube ${operation.elementId} did not exist when refinement began.`,
        );
      if (
        session.scopeGroupId !== undefined &&
        operation.expectedParentGroupId !== session.scopeGroupId
      )
        violations.push(
          `Cube ${operation.elementId} lies outside the refinement scope group.`,
        );
      if (
        operation.kind === "move_cube" &&
        operation.from.min.some(
          (value, axis) =>
            operation.from.max[axis]! - value !==
            operation.to.max[axis]! - operation.to.min[axis]!,
        )
      )
        violations.push(
          `Cube ${operation.elementId} would change size during an automatic pass.`,
        );
    }
    return {
      sessionId,
      transactionId: draft.transactionId,
      allowed: violations.length === 0,
      violations,
      operationCount: draft.operations.length,
    };
  }

  recordCorrection(sessionId: RefinementSessionId): RefinementSession {
    const record = this.#require(sessionId);
    record.session = refinementSessionSchema.parse({
      ...record.session,
      correctionsApplied: record.session.correctionsApplied + 1,
    });
    return record.session;
  }

  stop(
    sessionId: RefinementSessionId,
    reason: RefinementStopReason,
    now = Date.now(),
  ): RefinementReport {
    const record = this.#require(sessionId);
    if (record.session.status === "active") {
      record.session = refinementSessionSchema.parse({
        ...record.session,
        status: "stopped",
        stopReason: reason,
        stoppedAt: new Date(now).toISOString(),
      });
      record.stoppedAtMilliseconds = now;
    }
    return this.report(sessionId, now);
  }

  report(sessionId: RefinementSessionId, now = Date.now()): RefinementReport {
    const record = this.#require(sessionId);
    return refinementReportSchema.parse({
      session: record.session,
      passes: record.passes,
      elapsedMilliseconds:
        (record.stoppedAtMilliseconds ?? now) - record.startedAtMilliseconds,
    });
  }
}
