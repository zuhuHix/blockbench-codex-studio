import { z } from "zod";

import { elementIdSchema } from "./scene.js";
import { transactionIdSchema } from "./transactions.js";

/** One completed tool call. Never holds prompts, images, or secrets. */
export const toolLogEntrySchema = z.object({
  toolName: z.string().min(1),
  startedAt: z.iso.datetime(),
  durationMilliseconds: z.number().int().nonnegative(),
  success: z.boolean(),
  /** Redacted failure message; absent on success. */
  error: z.string().min(1).optional(),
  affectedElementIds: z.array(elementIdSchema),
  transactionId: transactionIdSchema.optional(),
});

export const diagnosticsVersionsSchema = z.object({
  mcpServer: z.string().min(1),
  node: z.string().min(1),
  plugin: z.string().min(1).optional(),
  blockbench: z.string().min(1).optional(),
  codex: z.string().min(1).optional(),
});

export const diagnosticsConnectionSchema = z.object({
  /** Host and port only; the bearer token is never included. */
  url: z.string().min(1),
  tokenConfigured: z.boolean(),
  blockbench: z.enum(["connected", "disconnected"]),
  lastSnapshotAt: z.iso.datetime().optional(),
});

export const diagnosticsProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  formatId: z.string().min(1),
  elementCount: z.number().int().nonnegative(),
});

/** Work that survived an unexpected shutdown, reported but never replayed. */
export const recoveredDraftSchema = z.object({
  transactionId: transactionIdSchema,
  projectId: z.string().min(1),
  label: z.string().min(1),
  operationCount: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime(),
});

export const recoveredCommandSchema = z.object({
  commandId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.string().min(1),
  recordedAt: z.iso.datetime(),
});

export const recoveryReportSchema = z.object({
  journalPath: z.string().min(1),
  /** True when the previous run ended without clearing its journal. */
  unclean: z.boolean(),
  drafts: z.array(recoveredDraftSchema),
  commands: z.array(recoveredCommandSchema),
  /** Journal entries dropped because they were older than the retention window. */
  staleDiscarded: z.number().int().nonnegative(),
});

export const diagnosticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  versions: diagnosticsVersionsSchema,
  connection: diagnosticsConnectionSchema,
  project: diagnosticsProjectSchema.optional(),
  activeModel: z.string().min(1).optional(),
  serviceTier: z.string().min(1).optional(),
  permissions: z.array(z.string().min(1)),
  imageProviders: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      available: z.boolean(),
      detail: z.string().min(1).optional(),
    }),
  ),
  openDraftCount: z.number().int().nonnegative(),
  pendingCommandCount: z.number().int().nonnegative(),
  recentTools: z.array(toolLogEntrySchema),
  recentErrors: z.array(toolLogEntrySchema),
  recovery: recoveryReportSchema.optional(),
});

export const selfTestCheckSchema = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1),
});

export const selfTestReportSchema = z.object({
  ranAt: z.iso.datetime(),
  passed: z.boolean(),
  checks: z.array(selfTestCheckSchema).min(1),
});

export type ToolLogEntry = z.infer<typeof toolLogEntrySchema>;
export type DiagnosticsReport = z.infer<typeof diagnosticsReportSchema>;
export type RecoveryReport = z.infer<typeof recoveryReportSchema>;
export type RecoveredDraft = z.infer<typeof recoveredDraftSchema>;
export type RecoveredCommand = z.infer<typeof recoveredCommandSchema>;
export type SelfTestCheck = z.infer<typeof selfTestCheckSchema>;
export type SelfTestReport = z.infer<typeof selfTestReportSchema>;
