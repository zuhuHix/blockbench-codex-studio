import { describe, expect, it } from "vitest";
import { blockbenchSnapshotSchema } from "@blockbench-codex/contracts";

import { buildDiagnosticsReport, runSelfTest } from "./diagnostics.js";
import { DiagnosticsStore, redactDiagnosticText } from "./diagnostics-store.js";
import { DraftStore } from "./draft-store.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { ImageProviderProbes } from "./image-providers.js";

const probes: ImageProviderProbes = {
  env: {},
  codexInstalled: () => false,
  credentialStored: () => Promise.resolve(false),
  comfyUiReachable: () => Promise.resolve(false),
  now: () => new Date("2026-01-01T00:00:00.000Z"),
};

const snapshot = blockbenchSnapshotSchema.parse({
  bridgeVersion: 1,
  project: { id: "specimen", name: "Specimen Chamber", formatId: "free" },
  selection: [],
  outline: [],
  elements: [],
  pluginVersion: "0.2.0",
  blockbenchVersion: "5.1.0",
  capturedAt: "2026-01-01T00:00:00.000Z",
});

function dependencies(store = new SnapshotStore()) {
  return {
    store,
    drafts: new DraftStore(),
    log: new DiagnosticsStore(),
    imageProbes: probes,
    host: "127.0.0.1",
    port: 48172,
    tokenConfigured: true,
  };
}

describe("redactDiagnosticText", () => {
  it("removes bearer tokens, API keys, and the home directory", () => {
    const redacted = redactDiagnosticText(
      "Bearer abcdef1234567890abcdef1234567890abcdef failed for C:\\Users\\zuhu\\model.bbmodel?api_key=hunter2",
    );

    expect(redacted).not.toContain("abcdef1234567890");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("zuhu");
    expect(redacted).toContain("%USERPROFILE%");
  });
});

describe("buildDiagnosticsReport", () => {
  it("reports versions and connection without revealing the token", async () => {
    const store = new SnapshotStore();
    store.set(snapshot);

    const report = await buildDiagnosticsReport(dependencies(store));

    expect(report.versions.plugin).toBe("0.2.0");
    expect(report.versions.blockbench).toBe("5.1.0");
    expect(report.connection).toMatchObject({
      url: "http://127.0.0.1:48172/mcp",
      tokenConfigured: true,
      blockbench: "connected",
    });
    expect(report.project).toMatchObject({ name: "Specimen Chamber" });
    expect(JSON.stringify(report)).not.toContain("Bearer");
  });

  it("reports a disconnected bridge and recent tool errors", async () => {
    const base = dependencies();
    base.log.record({
      toolName: "commit_draft",
      startedAtMilliseconds: Date.parse("2026-01-01T00:00:00.000Z"),
      durationMilliseconds: 12,
      success: false,
      error: "Cube changed after drafting.",
    });

    const report = await buildDiagnosticsReport(base);

    expect(report.connection.blockbench).toBe("disconnected");
    expect(report.project).toBeUndefined();
    expect(report.recentErrors).toHaveLength(1);
    expect(report.recentErrors[0]?.toolName).toBe("commit_draft");
  });
});

describe("runSelfTest", () => {
  it("fails when the bridge never connected", async () => {
    const report = await runSelfTest(dependencies());

    expect(report.passed).toBe(false);
    expect(
      report.checks.find(
        (check) => check.name === "Blockbench bridge connected",
      )?.passed,
    ).toBe(false);
    expect(
      report.checks.find((check) => check.name === "Bearer token configured")
        ?.passed,
    ).toBe(true);
  });

  it("passes the connection checks once a snapshot is published", async () => {
    const store = new SnapshotStore();
    store.set(snapshot);

    const report = await runSelfTest(dependencies(store));

    expect(
      report.checks.find((check) => check.name === "Active project published")
        ?.passed,
    ).toBe(true);
    expect(
      report.checks.find((check) => check.name === "Command queue drained")
        ?.passed,
    ).toBe(true);
  });
});
