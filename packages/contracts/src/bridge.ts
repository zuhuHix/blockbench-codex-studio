import { z } from "zod";

import {
  bounds3Schema,
  cubeElementSchema,
  elementIdSchema,
  groupIdSchema,
} from "./scene.js";

export const outlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.object({
    id: z.union([groupIdSchema, elementIdSchema]),
    name: z.string().min(1),
    type: z.enum(["group", "cube", "mesh", "other"]),
    children: z.array(outlineNodeSchema).default([]),
  }),
);

export interface OutlineNode {
  readonly id: string;
  readonly name: string;
  readonly type: "group" | "cube" | "mesh" | "other";
  readonly children: readonly OutlineNode[];
}

export const viewportCaptureSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]),
  dataBase64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: z.iso.datetime(),
});

export const blockbenchSnapshotSchema = z.object({
  bridgeVersion: z.literal(1),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    formatId: z.string().min(1),
    bounds: bounds3Schema.optional(),
  }),
  selection: z.array(elementIdSchema),
  outline: z.array(outlineNodeSchema),
  elements: z.array(cubeElementSchema),
  viewport: viewportCaptureSchema.optional(),
  capturedAt: z.iso.datetime(),
});

export type BlockbenchSnapshot = z.infer<typeof blockbenchSnapshotSchema>;
export type ViewportCapture = z.infer<typeof viewportCaptureSchema>;
