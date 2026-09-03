import { version as nodeVersion } from "node:process";

import {
  diagnosticsReportSchema,
  selfTestReportSchema,
  type DiagnosticsReport,
  type RecoveryReport,
  type SelfTestCheck,
  type SelfTestReport,
} from "@blockbench-codex/contracts";

import type { DraftStore } from "./draft-store.js";
import type { DiagnosticsStore } from "./diagnostics-store.js";
import type { SnapshotStore } from "./snapshot-store.js";
import {
  defaultImageProviderProbes,
  detectImageProviders,
  type ImageProviderProbes,
} from "./image-providers.js";
import { redactDiagnosticText } from "./diagnostics-store.js";

export const mcpServerVersion = "0.1.0";

/** Everything the server can do without asking the user again. */
const grantedPermissions = [
  "read active project snapshot",
  "queue reviewed draft commands",
  "write generated textures to the chosen folder",
] as const;

export interface DiagnosticsDependencies {
  readonly store: SnapshotStore;
  readonly drafts: DraftStore;
  readonly log: DiagnosticsStore;
  readonly imageProbes?: ImageProviderProbes;
  readonly host: string;
  readonly port: number;
  readonly tokenConfigured: boolean;
  readonly recovery?: RecoveryReport;
  readonly now?: () => number;
}

/**
 * Builds the diagnostics page payload. The bearer token never appears here, so
 * the report is safe to copy into a bug report as-is.
 */
export async function buildDiagnosticsReport(
  dependencies: DiagnosticsDependencies,
): Promise<DiagnosticsReport> {
  const now = dependencies.now ?? Date.now;
  const snapshot = dependencies.store.get();
  const status = dependencies.store.status(now());
  let providers: DiagnosticsReport["imageProviders"];
  try {
    const report = await detectImageProviders(
      dependencies.imageProbes ?? defaultImageProviderProbes,
    );
    providers = report.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      available: provider.available,
      detail: redactDiagnosticText(provider.detail),
    }));
  } catch (error) {
    providers = [
      {
        id: "detection-failed",
        label: "Image providers",
        available: false,
        detail: redactDiagnosticText(
          error instanceof Error ? error.message : "Detection failed.",
        ),
      },
    ];
  }

  return diagnosticsReportSchema.parse({
    generatedAt: new Date(now()).toISOString(),
    versions: {
      mcpServer: mcpServerVersion,
      node: nodeVersion,
      ...(snapshot?.pluginVersion === undefined
        ? {}
        : { plugin: snapshot.pluginVersion }),
      ...(snapshot?.blockbenchVersion === undefined
        ? {}
        : { blockbench: snapshot.blockbenchVersion }),
    },
    connection: {
      url: `http://${dependencies.host}:${dependencies.port}/mcp`,
      tokenConfigured: dependencies.tokenConfigured,
      blockbench: status.connected ? "connected" : "disconnected",
      ...(status.lastSnapshotAt === undefined
        ? {}
        : { lastSnapshotAt: status.lastSnapshotAt }),
    },
    ...(snapshot === undefined
      ? {}
      : {
          project: {
            id: snapshot.project.id,
            name: snapshot.project.name,
            formatId: snapshot.project.formatId,
            elementCount: snapshot.elements.length,
          },
        }),
    permissions: [...grantedPermissions],
    imageProviders: providers,
    openDraftCount: dependencies.drafts.openDrafts().length,
    pendingCommandCount: dependencies.drafts.pending().length,
    recentTools: dependencies.log.recent(),
    recentErrors: dependencies.log.recentErrors(),
    ...(dependencies.recovery === undefined
      ? {}
      : { recovery: dependencies.recovery }),
  });
}

/**
 * Checks the pieces a user can actually act on when something looks broken:
 * the bridge, the snapshot freshness, the queue, and an image backend.
 */
export async function runSelfTest(
  dependencies: DiagnosticsDependencies,
): Promise<SelfTestReport> {
  const now = dependencies.now ?? Date.now;
  const report = await buildDiagnosticsReport(dependencies);
  const stalledCommands = dependencies.drafts.pending().length;
  const checks: SelfTestCheck[] = [
    {
      name: "Bearer token configured",
      passed: dependencies.tokenConfigured,
      detail: dependencies.tokenConfigured
        ? "The server requires a bearer token on every request."
        : "No bearer token is configured; the bridge cannot authenticate.",
    },
    {
      name: "Blockbench bridge connected",
      passed: report.connection.blockbench === "connected",
      detail:
        report.connection.blockbench === "connected"
          ? `Last snapshot at ${report.connection.lastSnapshotAt ?? "unknown"}.`
          : "Blockbench has not published a recent snapshot. Reconnect from the panel.",
    },
    {
      name: "Active project published",
      passed: report.project !== undefined,
      detail:
        report.project === undefined
          ? "No project snapshot has arrived yet."
          : `${report.project.name} (${report.project.formatId}) with ${report.project.elementCount} elements.`,
    },
    {
      name: "Command queue drained",
      passed: stalledCommands === 0,
      detail:
        stalledCommands === 0
          ? "No command is waiting for Blockbench to acknowledge it."
          : `${stalledCommands} command(s) are still waiting for acknowledgement.`,
    },
    {
      name: "Image provider available",
      passed: report.imageProviders.some((provider) => provider.available),
      detail:
        report.imageProviders.find((provider) => provider.available)?.detail ??
        "No image backend is configured; texture generation is unavailable.",
    },
    {
      name: "No recent tool errors",
      passed: report.recentErrors.length === 0,
      detail:
        report.recentErrors.length === 0
          ? "The recent tool history is clean."
          : `${report.recentErrors.length} recent tool call(s) failed, latest: ${report.recentErrors[0]?.toolName ?? "unknown"}.`,
    },
  ];

  return selfTestReportSchema.parse({
    ranAt: new Date(now()).toISOString(),
    passed: checks.every((check) => check.passed),
    checks,
  });
}
