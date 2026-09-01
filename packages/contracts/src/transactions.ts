import { z } from "zod";

import { bounds3Schema, elementIdSchema, groupIdSchema } from "./scene.js";

export const transactionIdSchema = z.string().uuid().brand<"TransactionId">();

export const moveCubeOperationSchema = z.object({
  kind: z.literal("move_cube"),
  elementId: elementIdSchema,
  from: bounds3Schema,
  to: bounds3Schema,
  preserveSize: z.literal(true),
  expectedParentGroupId: groupIdSchema,
});

export const draftOperationSchema = z.discriminatedUnion("kind", [
  moveCubeOperationSchema,
]);

export const draftSummarySchema = z.object({
  transactionId: transactionIdSchema,
  label: z.string().min(1),
  operations: z.array(draftOperationSchema),
  warningCount: z.number().int().nonnegative(),
});

export type DraftOperation = z.infer<typeof draftOperationSchema>;
export type DraftSummary = z.infer<typeof draftSummarySchema>;
export type MoveCubeOperation = z.infer<typeof moveCubeOperationSchema>;
export type TransactionId = z.infer<typeof transactionIdSchema>;
