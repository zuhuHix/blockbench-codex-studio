import { z } from "zod";

import { viewAngleSchema } from "./bridge.js";
import {
  bounds3Schema,
  cubeFaceNameSchema,
  cubeFaceUvSchema,
  cubeFacesSchema,
  elementIdSchema,
  groupIdSchema,
  vector3Schema,
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

/**
 * Builder operations. Unlike the two edit operations above they change the
 * outliner itself, so every one of them carries the identifier the plugin must
 * assign; that keeps the draft, the journal, and the live scene addressable by
 * the same UUID even though the node does not exist yet when the draft is made.
 */
export const createGroupOperationSchema = z.object({
  kind: z.literal("create_group"),
  groupId: groupIdSchema,
  name: z.string().min(1).max(80),
  parentGroupId: groupIdSchema,
  origin: vector3Schema.default([0, 0, 0]),
});

export const createCubeOperationSchema = z.object({
  kind: z.literal("create_cube"),
  elementId: elementIdSchema,
  name: z.string().min(1).max(80),
  parentGroupId: groupIdSchema,
  bounds: bounds3Schema,
  rotation: vector3Schema.default([0, 0, 0]),
  faces: cubeFacesSchema.optional(),
});

export const resizeCubeOperationSchema = z.object({
  kind: z.literal("resize_cube"),
  elementId: elementIdSchema,
  from: bounds3Schema,
  to: bounds3Schema,
  expectedParentGroupId: groupIdSchema,
});

export const deleteCubeOperationSchema = z.object({
  kind: z.literal("delete_cube"),
  elementId: elementIdSchema,
  name: z.string().min(1),
  from: bounds3Schema,
  expectedParentGroupId: groupIdSchema,
});

export const renameCubeOperationSchema = z.object({
  kind: z.literal("rename_cube"),
  elementId: elementIdSchema,
  from: z.string().min(1),
  to: z.string().min(1).max(80),
  expectedParentGroupId: groupIdSchema,
});

export const draftOperationSchema = z.discriminatedUnion("kind", [
  moveCubeOperationSchema,
  setFaceUvOperationSchema,
  createGroupOperationSchema,
  createCubeOperationSchema,
  resizeCubeOperationSchema,
  deleteCubeOperationSchema,
  renameCubeOperationSchema,
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

/**
 * A whole repainted texture. The server composites strokes against the pixels
 * the plugin published, so the plugin only ever swaps in finished PNG bytes.
 */
export const paintTextureCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  action: z.literal("paint_texture"),
  label: z.string().min(1),
  textureId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dataBase64: z.string().min(1),
});

export const captureViewsCommandSchema = z.object({
  commandId: z.string().uuid(),
  projectId: z.string().min(1),
  action: z.literal("capture_views"),
  requestId: z.string().uuid(),
  angles: z.array(viewAngleSchema).min(1).max(7),
  size: z.number().int().min(64).max(2048),
});

export const bridgeCommandSchema = z.union([
  applyDraftCommandSchema,
  setSelectionCommandSchema,
  undoCommandSchema,
  importTextureCommandSchema,
  paintTextureCommandSchema,
  captureViewsCommandSchema,
]);

export const commandAcknowledgementSchema = z.object({
  commandId: z.string().uuid(),
  success: z.boolean(),
  error: z.string().min(1).optional(),
});

export type DraftOperation = z.infer<typeof draftOperationSchema>;
export type DraftSummary = z.infer<typeof draftSummarySchema>;
export type CreateGroupOperation = z.infer<typeof createGroupOperationSchema>;
export type CreateCubeOperation = z.infer<typeof createCubeOperationSchema>;
export type ResizeCubeOperation = z.infer<typeof resizeCubeOperationSchema>;
export type DeleteCubeOperation = z.infer<typeof deleteCubeOperationSchema>;
export type RenameCubeOperation = z.infer<typeof renameCubeOperationSchema>;
export type MoveCubeOperation = z.infer<typeof moveCubeOperationSchema>;
export type SetFaceUvOperation = z.infer<typeof setFaceUvOperationSchema>;
export type TransactionId = z.infer<typeof transactionIdSchema>;
export type ApplyDraftCommand = z.infer<typeof applyDraftCommandSchema>;
export type SetSelectionCommand = z.infer<typeof setSelectionCommandSchema>;
export type UndoCommand = z.infer<typeof undoCommandSchema>;
export type ImportTextureCommand = z.infer<typeof importTextureCommandSchema>;
export type PaintTextureCommand = z.infer<typeof paintTextureCommandSchema>;
export type CaptureViewsCommand = z.infer<typeof captureViewsCommandSchema>;
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;
export type CommandAcknowledgement = z.infer<
  typeof commandAcknowledgementSchema
>;
