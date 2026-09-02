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
