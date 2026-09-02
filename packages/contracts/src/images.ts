import { z } from "zod";

export const imageProviderIdSchema = z.enum([
  "codex-native",
  "openai-image",
  "comfyui",
]);

/** Where a provider's configuration was found. Never the configured value. */
export const imageCredentialSourceSchema = z.enum([
  "none",
  "environment",
  "windows-credential-manager",
  "local-service",
]);

export const imageProviderStatusSchema = z.object({
  id: imageProviderIdSchema,
  label: z.string().min(1),
  available: z.boolean(),
  /** Plain explanation of the detection result, free of secrets. */
  detail: z.string().min(1),
  credentialSource: imageCredentialSourceSchema,
  incursApiCost: z.boolean(),
});

export const imageProviderReportSchema = z.object({
  providers: z.array(imageProviderStatusSchema).min(1),
  /** The backend that will be used, or null when none is configured. */
  selectedProviderId: imageProviderIdSchema.nullable(),
  /** True when the selected backend may bill the user's own account. */
  incursApiCost: z.boolean(),
  detectedAt: z.iso.datetime(),
});

export type ImageProviderId = z.infer<typeof imageProviderIdSchema>;
export type ImageCredentialSource = z.infer<typeof imageCredentialSourceSchema>;
export type ImageProviderStatus = z.infer<typeof imageProviderStatusSchema>;
export type ImageProviderReport = z.infer<typeof imageProviderReportSchema>;

/** Where a reference image came from, as shown on its chip. */
export const imageReferenceSourceSchema = z.enum([
  "viewport",
  "standard-view",
  "selected-texture",
  "project-texture",
  "imported-file",
  "generated-variant",
  "clipboard",
]);

/** How the model should use a reference, stated explicitly in the prompt. */
export const imageReferenceRoleSchema = z.enum([
  "shape",
  "palette",
  "layout",
  "style",
  "edit-target",
]);

export const imageMimeTypeSchema = z.enum(["image/png", "image/jpeg"]);

export const imageReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  source: imageReferenceSourceSchema,
  role: imageReferenceRoleSchema,
  mimeType: imageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  addedAt: z.iso.datetime(),
});

export const imageGenerationModeSchema = z.enum([
  "new-seamless-texture",
  "edit-current-texture",
  "uv-atlas",
  "transparent-decal",
  "concept-reference",
  "variation",
  "inpaint-region",
  "outpaint-extend",
  "pixel-art-conversion",
]);

export const imageSizeSchema = z.object({
  width: z.number().int().positive().max(2048),
  height: z.number().int().positive().max(2048),
});

export const imageGenerationRequestSchema = z.object({
  mode: imageGenerationModeSchema,
  prompt: z.string().min(1).max(2000),
  referenceIds: z.array(z.string().min(1)).max(8).default([]),
  size: imageSizeSchema.default({ width: 512, height: 512 }),
  transparentBackground: z.boolean().default(false),
  seed: z.number().int().nonnegative().optional(),
});

/**
 * The exact request that would be sent, including which references travel with
 * it and in which role. Producing a plan never contacts a provider.
 */
export const imageGenerationPlanSchema = z.object({
  requestId: z.string().min(1),
  mode: imageGenerationModeSchema,
  prompt: z.string().min(1),
  size: imageSizeSchema,
  transparentBackground: z.boolean(),
  seed: z.number().int().nonnegative().optional(),
  providerId: imageProviderIdSchema.nullable(),
  incursApiCost: z.boolean(),
  references: z.array(imageReferenceSchema),
  warnings: z.array(z.string().min(1)),
  /** False while any warning would make the request meaningless or unroutable. */
  dispatchable: z.boolean(),
  plannedAt: z.iso.datetime(),
});

/** One generated result. Nothing is imported or saved because it exists. */
export const imageVariantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  requestId: z.string().min(1).optional(),
  mode: imageGenerationModeSchema,
  prompt: z.string().min(1),
  providerId: imageProviderIdSchema,
  seed: z.number().int().nonnegative().optional(),
  mimeType: imageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  /** The image can carry transparency; real pixel alpha is verified at import. */
  hasAlphaChannel: z.boolean(),
  generationMs: z.number().int().nonnegative().optional(),
  favorite: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const imageVariantImageSchema = z.object({
  variant: imageVariantSchema,
  dataBase64: z.string().min(1),
});

export type ImageVariant = z.infer<typeof imageVariantSchema>;
export type ImageVariantImage = z.infer<typeof imageVariantImageSchema>;

export type ImageReferenceSource = z.infer<typeof imageReferenceSourceSchema>;
export type ImageReferenceRole = z.infer<typeof imageReferenceRoleSchema>;
export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;
export type ImageReference = z.infer<typeof imageReferenceSchema>;
export type ImageGenerationMode = z.infer<typeof imageGenerationModeSchema>;
export type ImageSize = z.infer<typeof imageSizeSchema>;
export type ImageGenerationRequest = z.infer<
  typeof imageGenerationRequestSchema
>;
export type ImageGenerationPlan = z.infer<typeof imageGenerationPlanSchema>;
