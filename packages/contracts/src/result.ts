import { z } from "zod";

export const toolErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "NOT_CONNECTED",
  "NOT_FOUND",
  "CONFLICT",
  "OUT_OF_BOUNDS",
  "PERMISSION_DENIED",
  "CANCELLED",
  "INTERNAL_ERROR",
]);

export const toolErrorSchema = z.object({
  code: toolErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const toolResultSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({ ok: z.literal(false), error: toolErrorSchema }),
  ]);

export type ToolError = z.infer<typeof toolErrorSchema>;
export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;
export type ToolResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ToolError };
