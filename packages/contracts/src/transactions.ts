import { z } from "zod";

import {
  bounds3Schema,
  cubeFaceNameSchema,
  cubeFaceUvSchema,
  elementIdSchema,
  groupIdSchema,
} from "./scene.js";

export const transactionIdSchema = z.string().uuid().brand<"TransactionId">();

export const moveCubeOperationSchema = z.object({
  kind: z.literal("move_cube"),
  elementId: elementIdSchema,
  from: bounds3Schema,
  to: bounds3Schema,
  preserveSize: z.literal(true),
  expectedParentGroupId: groupIdSchema,
});

export const setFaceUvOperationSchema = z.object({
  kind: z.literal("set_face_uv"),
  elementId: elementIdSchema,
  face: cubeFaceNameSchema,
  from: cubeFaceUvSchema,
  to: cubeFaceUvSchema,
  expectedParentGroupId: groupIdSchema,
});

export const draftOperationSchema = z.discriminatedUnion("kind", [
  moveCubeOperationSchema,
  setFaceUvOperationSchema,
]);

export const draftSummarySchema = z.object({
  transactionId: transactionIdSchema,
  label: z.string().min(1),
  operations: z.array(draftOperationSchema),
  warningCount: z.number().int().nonnegative(),
});

export const applyDraftCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  transactionId: transactionIdSchema,
  label: z.string().min(1),
  operations: z.array(draftOperationSchema).min(1),
});

export const setSelectionCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  elementIds: z.array(elementIdSchema).min(1),
});

export const undoCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  action: z.literal("undo"),
});

export const importTextureCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  action: z.literal("import_texture"),
  label: z.string().min(1),
  absolutePath: z.string().min(1),
  textureName: z.string().min(1),
  applyElementIds: z.array(elementIdSchema),
});

export const bridgeCommandSchema = z.union([
  applyDraftCommandSchema,
  setSelectionCommandSchema,
  undoCommandSchema,
  importTextureCommandSchema,
]);

export const commandAcknowledgementSchema = z.object({
  commandId: z.string().uuid(),
  success: z.boolean(),
  error: z.string().min(1).optional(),
});

export type DraftOperation = z.infer<typeof draftOperationSchema>;
export type DraftSummary = z.infer<typeof draftSummarySchema>;
export type MoveCubeOperation = z.infer<typeof moveCubeOperationSchema>;
export type SetFaceUvOperation = z.infer<typeof setFaceUvOperationSchema>;
export type TransactionId = z.infer<typeof transactionIdSchema>;
export type ApplyDraftCommand = z.infer<typeof applyDraftCommandSchema>;
export type SetSelectionCommand = z.infer<typeof setSelectionCommandSchema>;
export type UndoCommand = z.infer<typeof undoCommandSchema>;
export type ImportTextureCommand = z.infer<typeof importTextureCommandSchema>;
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;
export type CommandAcknowledgement = z.infer<
  typeof commandAcknowledgementSchema
>;
