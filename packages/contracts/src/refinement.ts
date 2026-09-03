import { z } from "zod";

import { viewAngleSchema } from "./bridge.js";
import { elementIdSchema, groupIdSchema } from "./scene.js";
import { transactionIdSchema } from "./transactions.js";

export const refinementSessionIdSchema = z
  .string()
  .uuid()
  .brand<"RefinementSessionId">();

/** Why an auto-refinement run ended. Always reported to the user. */
export const refinementStopReasonSchema = z.enum([
  "satisfied",
  "limit-reached",
  "no-safe-correction",
  "stopped-by-user",
]);

export const refinementPassSchema = z.object({
  pass: z.number().int().positive(),
  remainingPasses: z.number().int().nonnegative(),
  angles: z.array(viewAngleSchema).min(1),
  note: z.string().min(1).optional(),
  capturedAt: z.iso.datetime(),
});

export const refinementSessionSchema = z.object({
  sessionId: refinementSessionIdSchema,
  projectId: z.string().min(1),
  goal: z.string().min(1),
  /** Corrections may never leave this group when it is set. */
  scopeGroupId: groupIdSchema.optional(),
  /** Elements that existed when the run began; nothing else may be touched. */
  baselineElementIds: z.array(elementIdSchema),
  maxPasses: z.number().int().min(1).max(4),
  passesUsed: z.number().int().nonnegative(),
  correctionsApplied: z.number().int().nonnegative(),
  imagesCaptured: z.number().int().nonnegative(),
  status: z.enum(["active", "stopped"]),
  stopReason: refinementStopReasonSchema.optional(),
  startedAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().optional(),
});

export const refinementReportSchema = z.object({
  session: refinementSessionSchema,
  passes: z.array(refinementPassSchema),
  elapsedMilliseconds: z.number().int().nonnegative(),
});

export const refinementDraftCheckSchema = z.object({
  sessionId: refinementSessionIdSchema,
  transactionId: transactionIdSchema,
  allowed: z.boolean(),
  /** Every rule the proposed correction breaks, in plain language. */
  violations: z.array(z.string().min(1)),
  operationCount: z.number().int().nonnegative(),
});

export type RefinementSessionId = z.infer<typeof refinementSessionIdSchema>;
export type RefinementStopReason = z.infer<typeof refinementStopReasonSchema>;
export type RefinementPass = z.infer<typeof refinementPassSchema>;
export type RefinementSession = z.infer<typeof refinementSessionSchema>;
export type RefinementReport = z.infer<typeof refinementReportSchema>;
export type RefinementDraftCheck = z.infer<typeof refinementDraftCheckSchema>;
