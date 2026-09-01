import { z } from "zod";

export const elementIdSchema = z.string().min(1).brand<"ElementId">();
export const groupIdSchema = z.string().min(1).brand<"GroupId">();

export const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const bounds3Schema = z
  .object({
    min: vector3Schema,
    max: vector3Schema,
  })
  .refine(
    ({ min, max }) => min.every((coordinate, axis) => coordinate < max[axis]!),
    "Each minimum coordinate must be lower than its maximum coordinate.",
  );

export const cubeElementSchema = z.object({
  id: elementIdSchema,
  name: z.string().min(1),
  parentGroupId: groupIdSchema,
  bounds: bounds3Schema,
  rotation: vector3Schema.default([0, 0, 0]),
  visible: z.boolean().default(true),
});

export const selectionSnapshotSchema = z.object({
  projectId: z.string().min(1),
  selectedElementIds: z.array(elementIdSchema),
  capturedAt: z.iso.datetime(),
});

export type Bounds3 = z.infer<typeof bounds3Schema>;
export type CubeElement = z.infer<typeof cubeElementSchema>;
export type ElementId = z.infer<typeof elementIdSchema>;
export type GroupId = z.infer<typeof groupIdSchema>;
export type SelectionSnapshot = z.infer<typeof selectionSnapshotSchema>;
export type Vector3 = z.infer<typeof vector3Schema>;
