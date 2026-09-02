import { z } from "zod";

export const elementIdSchema = z.string().min(1).brand<"ElementId">();
export const groupIdSchema = z.string().min(1).brand<"GroupId">();

export const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const vector2Schema = z.tuple([z.number(), z.number()]);

export const cubeFaceNames = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;
export const cubeFaceNameSchema = z.enum(cubeFaceNames);
export const uvRectSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export const cubeFaceUvSchema = z.object({
  textureId: z.string().min(1).nullable(),
  uv: uvRectSchema,
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  enabled: z.boolean(),
});
export const cubeFacesSchema = z.object(
  Object.fromEntries(cubeFaceNames.map((name) => [name, cubeFaceUvSchema])) as {
    [Key in (typeof cubeFaceNames)[number]]: typeof cubeFaceUvSchema;
  },
);

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
  faces: cubeFacesSchema.optional(),
});

export const selectionSnapshotSchema = z.object({
  projectId: z.string().min(1),
  selectedElementIds: z.array(elementIdSchema),
  capturedAt: z.iso.datetime(),
});

export type Bounds3 = z.infer<typeof bounds3Schema>;
export type CubeElement = z.infer<typeof cubeElementSchema>;
export type CubeFaceName = z.infer<typeof cubeFaceNameSchema>;
export type CubeFaceUv = z.infer<typeof cubeFaceUvSchema>;
export type CubeFaces = z.infer<typeof cubeFacesSchema>;
export type ElementId = z.infer<typeof elementIdSchema>;
export type GroupId = z.infer<typeof groupIdSchema>;
export type SelectionSnapshot = z.infer<typeof selectionSnapshotSchema>;
export type Vector3 = z.infer<typeof vector3Schema>;
export type Vector2 = z.infer<typeof vector2Schema>;
export type UvRect = z.infer<typeof uvRectSchema>;
