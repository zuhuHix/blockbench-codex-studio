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

/** The standard camera angles the plugin can drive for multi-view capture. */
export const viewAngleSchema = z.enum([
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "isometric",
]);

export const viewCaptureSchema = viewportCaptureSchema.extend({
  angle: viewAngleSchema,
});

/** One completed multi-view capture, answering a single capture_views command. */
export const multiViewCaptureSchema = z.object({
  requestId: z.string().uuid(),
  projectId: z.string().min(1),
  views: z.array(viewCaptureSchema).min(1),
  capturedAt: z.iso.datetime(),
});

/**
 * A texture as the plugin publishes it. `dataBase64` holds the full PNG so the
 * server can read and repaint real pixels; it is omitted for textures too large
 * to ship on every snapshot.
 */
export const textureSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dataBase64: z.string().min(1).optional(),
});

export const blockbenchSnapshotSchema = z.object({
  bridgeVersion: z.literal(1),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    formatId: z.string().min(1),
    /** Absolute path of the saved project file, when it has been saved. */
    filePath: z.string().min(1).optional(),
    bounds: bounds3Schema.optional(),
    textureSize: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .optional(),
  }),
  selection: z.array(elementIdSchema),
  outline: z.array(outlineNodeSchema),
  elements: z.array(cubeElementSchema),
  textures: z.array(textureSnapshotSchema).default([]),
  viewport: viewportCaptureSchema.optional(),
  /** Reported on the diagnostics page so installed versions stay distinguishable. */
  pluginVersion: z.string().min(1).optional(),
  blockbenchVersion: z.string().min(1).optional(),
  capturedAt: z.iso.datetime(),
});

export type TextureSnapshot = z.infer<typeof textureSnapshotSchema>;
export type BlockbenchSnapshot = z.infer<typeof blockbenchSnapshotSchema>;
export type ViewportCapture = z.infer<typeof viewportCaptureSchema>;
export type ViewAngle = z.infer<typeof viewAngleSchema>;
export type ViewCapture = z.infer<typeof viewCaptureSchema>;
export type MultiViewCapture = z.infer<typeof multiViewCaptureSchema>;
