import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  blockbenchSnapshotSchema,
  type DiagnosticsReport,
  type RecoveryReport,
  type SelfTestReport,
} from "@blockbench-codex/contracts";

import { createStudioApp, startStudioServer } from "./app.js";
import { SnapshotStore } from "./snapshot-store.js";
import { CrashJournal } from "./crash-recovery.js";

const token = "test-token-that-is-at-least-32-characters-long";
const authorization = { Authorization: `Bearer ${token}` };
const mappedFace = {
  textureId: "culture",
  uv: [0, 0, 4, 4],
  rotation: 0,
  enabled: true,
} as const;
const mappedFaces = {
  north: mappedFace,
  south: mappedFace,
  east: mappedFace,
  west: mappedFace,
  up: mappedFace,
  down: mappedFace,
};

const snapshot = blockbenchSnapshotSchema.parse({
  bridgeVersion: 1,
  project: {
    id: "specimen",
    name: "Specimen Chamber",
    formatId: "free",
    textureSize: { width: 32, height: 32 },
  },
  selection: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ],
  outline: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "culture_stage_2",
      type: "group",
      children: [],
    },
  ],
  elements: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "main_blob",
      parentGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bounds: { min: [6, 1, 6], max: [10, 4, 10] },
      rotation: [0, 0, 0],
      visible: true,
      faces: mappedFaces,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "tentacle_west_1",
      parentGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bounds: { min: [2, 2, 7], max: [4, 3, 8] },
      rotation: [0, 0, 0],
      visible: true,
      faces: mappedFaces,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "tentacle_west_2",
      parentGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bounds: { min: [-1, 2, 7], max: [1, 3, 8] },
      rotation: [0, 0, 0],
      visible: true,
      faces: mappedFaces,
    },
  ],
  capturedAt: "2026-09-01T09:00:00.000Z",
});

interface CapturedCommand {
  readonly commandId: string;
  readonly action?: string;
  readonly requestId: string;
  readonly angles: ("front" | "top")[];
  readonly size: number;
}

async function pollUntil(
  read: () => Promise<CapturedCommand | undefined>,
): Promise<CapturedCommand> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The capture command was never queued.");
}

const offlineProbes = {
  env: {},
  codexInstalled: () => false,
  credentialStored: () => Promise.resolve(false),
  comfyUiReachable: () => Promise.resolve(false),
  now: () => new Date("2026-09-02T10:00:00.000Z"),
};

describe("studio HTTP app", () => {
  it("serves diagnostics, a self-test, and the previous run's recovery report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bcs-app-journal-"));
    try {
      const journalPath = join(directory, "pending-work.json");
      new CrashJournal(journalPath).record({
        drafts: [],
        commands: [
          {
            commandId: "44444444-4444-4444-8444-444444444444",
            projectId: "specimen",
            action: "undo",
          },
        ],
      } as never);
      const app = createStudioApp(
        token,
        new SnapshotStore(),
        48172,
        offlineProbes,
        new CrashJournal(journalPath),
      );
      await request(app)
        .post("/bridge/snapshot")
        .set(authorization)
        .send(snapshot)
        .expect(202);

      const diagnostics = await request(app)
        .get("/bridge/diagnostics")
        .set(authorization)
        .expect(200);
      expect(diagnostics.body).toMatchObject({
        connection: {
          url: "http://127.0.0.1:48172/mcp",
          tokenConfigured: true,
        },
        project: { id: "specimen" },
        recovery: { unclean: true },
      });
      expect(diagnostics.text).not.toContain(token);

      const selfTest = await request(app)
        .post("/bridge/diagnostics/self-test")
        .set(authorization)
        .expect(200);
      expect((selfTest.body as SelfTestReport).checks.length).toBeGreaterThan(
        0,
      );

      const recovery = await request(app)
        .get("/bridge/recovery")
        .set(authorization)
        .expect(200);
      expect((recovery.body as RecoveryReport).commands).toHaveLength(1);

      const dismissed = await request(app)
        .post("/bridge/recovery/dismiss")
        .set(authorization)
        .expect(200);
      expect(dismissed.body).toMatchObject({ unclean: false, commands: [] });
      await request(app).get("/bridge/diagnostics").expect(401);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects unauthenticated and browser-origin requests", async () => {
    const app = createStudioApp(token);
    await request(app).get("/health").expect(401);
    await request(app)
      .get("/health")
      .set(authorization)
      .set("Origin", "http://evil.test")
      .expect(403);
  });

  it("accepts a typed snapshot and reports the bridge connected", async () => {
    const app = createStudioApp(token);
    await request(app)
      .post("/bridge/snapshot")
      .set(authorization)
      .send(snapshot)
      .expect(202);
    const response = await request(app)
      .get("/health")
      .set(authorization)
      .expect(200);
    expect(response.body).toMatchObject({
      server: "ok",
      blockbench: { connected: true },
    });
  });

  it("serves the image provider report without leaking credentials", async () => {
    const app = createStudioApp(token, new SnapshotStore(), 48172, {
      env: { OPENAI_API_KEY: "sk-secret-value" },
      codexInstalled: () => false,
      credentialStored: () => Promise.resolve(false),
      comfyUiReachable: () => Promise.resolve(false),
      now: () => new Date("2026-09-02T10:00:00.000Z"),
    });
    const response = await request(app)
      .get("/bridge/image-providers")
      .set(authorization)
      .expect(200);
    expect(response.body).toMatchObject({
      selectedProviderId: "openai-image",
      incursApiCost: true,
    });
    expect(response.text).not.toContain("sk-secret-value");
    await request(app).get("/bridge/image-providers").expect(401);
  });

  it("serves the gallery, favorites, and reference reuse over the bridge", async () => {
    const pngBase64 = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString("base64");
    const client = new Client({ name: "gallery-test", version: "1.0.0" });
    const server = await startStudioServer({ token, port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.port}/mcp`),
        { requestInit: { headers: authorization } },
      );
      await client.connect(transport);
      await client.callTool({
        name: "record_image_variant",
        arguments: {
          name: "Lab wall",
          mode: "new-seamless-texture",
          prompt: "mossy lab wall",
          providerId: "comfyui",
          mimeType: "image/png",
          dataBase64: pngBase64,
          width: 64,
          height: 64,
        },
      });

      const listed = await request(server.app)
        .get("/bridge/image-variants")
        .set(authorization)
        .expect(200);
      const [variant] = (listed.body as { variants: { id: string }[] })
        .variants;
      expect(variant).toBeDefined();
      expect(listed.text).not.toContain(pngBase64);

      const image = await request(server.app)
        .get(`/bridge/image-variants/${variant!.id}`)
        .set(authorization)
        .expect(200);
      expect((image.body as { dataBase64: string }).dataBase64).toBe(pngBase64);

      const favorited = await request(server.app)
        .post(`/bridge/image-variants/${variant!.id}/favorite`)
        .set(authorization)
        .send({ favorite: true })
        .expect(200);
      expect((favorited.body as { favorite: boolean }).favorite).toBe(true);

      const reference = await request(server.app)
        .post(`/bridge/image-variants/${variant!.id}/reference`)
        .set(authorization)
        .send({ role: "palette" })
        .expect(201);
      expect(reference.body).toMatchObject({
        source: "generated-variant",
        role: "palette",
        name: "Lab wall",
      });
      await request(server.app)
        .get("/bridge/image-references")
        .set(authorization)
        .expect(200);

      await request(server.app)
        .post(`/bridge/image-variants/${variant!.id}/remove`)
        .set(authorization)
        .expect(200);
      await request(server.app)
        .get(`/bridge/image-variants/${variant!.id}`)
        .set(authorization)
        .expect(404);
      await client.close();
    } finally {
      await server.close();
    }
  });

  it("rejects malformed snapshots", async () => {
    const app = createStudioApp(token);
    await request(app)
      .post("/bridge/snapshot")
      .set(authorization)
      .send({ project: { name: "missing fields" } })
      .expect(400);
  });

  it("creates an authenticated integrated chat session", async () => {
    const app = createStudioApp(token);
    const created = await request(app)
      .post("/bridge/chat/sessions")
      .set(authorization)
      .send({})
      .expect(201);
    const sessionId = String(
      (created.body as { sessionId: unknown }).sessionId,
    );
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/u);
    await request(app)
      .get(`/bridge/chat/${sessionId}/events?after=0`)
      .set(authorization)
      .expect(200, { events: [] });
  });

  it("logs failed tool calls into the diagnostics report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bcs-tool-log-"));
    const running = await startStudioServer({
      token,
      port: 0,
      journal: new CrashJournal(join(directory, "pending-work.json")),
    });
    const client = new Client({ name: "diagnostics-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp`),
      { requestInit: { headers: authorization } },
    );

    try {
      await client.connect(transport);
      // No snapshot has been published, so this tool must fail.
      await client.callTool({ name: "get_project_summary", arguments: {} });

      const diagnostics = await request(running.app)
        .get("/bridge/diagnostics")
        .set(authorization)
        .expect(200);
      const report = diagnostics.body as DiagnosticsReport;
      expect(report.recentErrors).toMatchObject([
        { toolName: "get_project_summary", success: false },
      ]);
      expect(report.recentTools[0]?.durationMilliseconds).toBeTypeOf("number");
    } finally {
      await client.close();
      await running.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("serves live Blockbench state through the MCP tool loop", async () => {
    const running = await startStudioServer({ token, port: 0 });
    running.store.set(snapshot);
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp`),
      { requestInit: { headers: authorization } },
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "health",
        "get_project_summary",
        "get_selection",
        "set_selection",
        "list_outline",
        "capture_viewport",
        "capture_views",
        "begin_draft",
        "move_cube_preserve_size",
        "get_draft_summary",
        "validate_draft",
        "commit_draft",
        "discard_draft",
        "undo",
        "connect_selected_chain",
        "inspect_connectivity",
        "get_cube_face_uvs",
        "set_face_uv",
        "project_connected_uv",
        "measure_uv_coverage",
        "audit_uv_seams",
        "pack_uv_islands",
        "normalize_texel_density",
        "detect_image_providers",
        "add_image_reference",
        "list_image_references",
        "remove_image_reference",
        "plan_image_generation",
        "record_image_variant",
        "generate_image",
        "list_image_variants",
        "inspect_image_transparency",
        "convert_image_to_pixel_art",
        "use_variant_as_reference",
        "get_texture_destination",
        "set_texture_destination",
        "save_image_variant",
        "import_image_variant",
        "begin_refinement",
        "refine_pass",
        "check_refinement_draft",
        "commit_refinement_draft",
        "stop_refinement",
        "get_refinement_report",
        "get_diagnostics",
        "run_self_test",
      ]);
      expect(
        tools.tools.find((tool) => tool.name === "get_selection")?.annotations,
      ).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const result = await client.callTool({
        name: "get_project_summary",
        arguments: {},
      });
      expect(JSON.stringify(result)).toContain(
        '\\"name\\": \\"Specimen Chamber\\"',
      );

      const selection = await client.callTool({
        name: "set_selection",
        arguments: {
          elementIds: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        },
      });
      expect(JSON.stringify(selection)).toContain('\\"elementIds\\": [');

      const begun = await client.callTool({
        name: "begin_draft",
        arguments: { label: "Move main blob safely" },
      });
      const transactionMatch =
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
          JSON.stringify(begun),
        );
      if (transactionMatch === null) throw new Error("Missing draft result.");
      const transactionId = transactionMatch[1]!;
      await client.callTool({
        name: "move_cube_preserve_size",
        arguments: {
          transactionId,
          elementId: "11111111-1111-4111-8111-111111111111",
          to: { min: [7, 1, 6], max: [11, 4, 10] },
        },
      });
      await client.callTool({
        name: "commit_draft",
        arguments: { transactionId },
      });
      const queued = await request(running.app)
        .get("/bridge/commands")
        .set(authorization)
        .expect(200);
      expect(queued.text).toContain('"projectId":"specimen"');
      expect(queued.text).toContain(
        '"elementIds":["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]',
      );
      expect(queued.text).toContain('"label":"Move main blob safely"');
      expect(queued.text).toContain('"from":{"min":[6,1,6],"max":[10,4,10]}');
      expect(queued.text).toContain('"to":{"min":[7,1,6],"max":[11,4,10]}');

      const semantic = await client.callTool({
        name: "connect_selected_chain",
        arguments: { label: "Connect specimen tentacles" },
      });
      const semanticText = JSON.stringify(semantic);
      expect(semanticText).toContain("11111111-1111-4111-8111-111111111111");
      expect(semanticText).toContain('\\"connectedEdgeCount\\": 2');

      const coverage = await client.callTool({
        name: "measure_uv_coverage",
        arguments: {},
      });
      expect(JSON.stringify(coverage)).toContain('\\"mappedFaceCount\\": 18');
      const projected = await client.callTool({
        name: "project_connected_uv",
        arguments: { label: "Continue blob UVs" },
      });
      expect(JSON.stringify(projected)).toContain(
        '\\"kind\\": \\"set_face_uv\\"',
      );
      expect(JSON.stringify(projected)).toContain('\\"operations\\": [');
    } finally {
      await client.close();
      await running.close();
    }
  });
  it("round-trips a multi-view capture between the MCP tool and the plugin", async () => {
    const running = await startStudioServer({ token, port: 0 });
    running.store.set(snapshot);
    const client = new Client({ name: "views-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp`),
      { requestInit: { headers: authorization } },
    );

    try {
      await client.connect(transport);
      const pending = client.callTool({
        name: "capture_views",
        arguments: { angles: ["front", "top"], size: 128 },
      });

      const queued = await pollUntil(async () => {
        const response = await request(running.app)
          .get("/bridge/commands")
          .set(authorization)
          .expect(200);
        return (response.body as { commands: CapturedCommand[] }).commands.find(
          (command) => command.action === "capture_views",
        );
      });
      expect(queued.angles).toEqual(["front", "top"]);
      expect(queued.size).toBe(128);

      await request(running.app)
        .post("/bridge/view-captures")
        .set(authorization)
        .send({
          requestId: queued.requestId,
          projectId: "specimen",
          views: queued.angles.map((angle) => ({
            angle,
            mimeType: "image/png",
            dataBase64: "aW1hZ2U=",
            width: 128,
            height: 128,
            capturedAt: new Date().toISOString(),
          })),
          capturedAt: new Date().toISOString(),
        })
        .expect(202);

      const result = JSON.stringify(await pending);
      expect(result).toContain('"type":"image"');
      expect(result).toContain("front");
      expect(result).toContain("top");
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("fails the awaiting capture tool when the plugin reports an error", async () => {
    const running = await startStudioServer({ token, port: 0 });
    running.store.set(snapshot);
    const client = new Client({ name: "views-failure-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp`),
      { requestInit: { headers: authorization } },
    );

    try {
      await client.connect(transport);
      const pending = client.callTool({
        name: "capture_views",
        arguments: { angles: ["front"] },
      });
      const queued = await pollUntil(async () => {
        const response = await request(running.app)
          .get("/bridge/commands")
          .set(authorization)
          .expect(200);
        return (response.body as { commands: CapturedCommand[] }).commands.find(
          (command) => command.action === "capture_views",
        );
      });
      await request(running.app)
        .post("/bridge/commands/ack")
        .set(authorization)
        .send({
          commandId: queued.commandId,
          success: false,
          error: "Blockbench has no active preview to capture.",
        })
        .expect(202);
      expect(JSON.stringify(await pending)).toContain("no active preview");
    } finally {
      await client.close();
      await running.close();
    }
  });
  it("bounds an auto-refinement run and lets the user stop it", async () => {
    const running = await startStudioServer({ token, port: 0 });
    running.store.set(snapshot);
    const client = new Client({ name: "refine-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${running.port}/mcp`),
      { requestInit: { headers: authorization } },
    );

    try {
      await client.connect(transport);
      const begun = JSON.stringify(
        await client.callTool({
          name: "begin_refinement",
          arguments: {
            goal: "Close the gap between the tentacles",
            maxPasses: 1,
            scopeGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        }),
      );
      expect(begun).toContain('\\"maxPasses\\": 1');
      const sessionId =
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu.exec(
          begun,
        )?.[1];
      if (sessionId === undefined) throw new Error("Missing session id.");

      const active = await request(running.app)
        .get("/bridge/refinement")
        .set(authorization)
        .expect(200);
      expect(active.text).toContain("Close the gap");

      const pending = client.callTool({
        name: "refine_pass",
        arguments: { sessionId, angles: ["front"], note: "First look" },
      });
      const queued = await pollUntil(async () => {
        const response = await request(running.app)
          .get("/bridge/commands")
          .set(authorization)
          .expect(200);
        return (response.body as { commands: CapturedCommand[] }).commands.find(
          (command) => command.action === "capture_views",
        );
      });
      await request(running.app)
        .post("/bridge/view-captures")
        .set(authorization)
        .send({
          requestId: queued.requestId,
          projectId: "specimen",
          views: [
            {
              angle: "front",
              mimeType: "image/png",
              dataBase64: "aW1hZ2U=",
              width: 768,
              height: 768,
              capturedAt: new Date().toISOString(),
            },
          ],
          capturedAt: new Date().toISOString(),
        })
        .expect(202);
      expect(JSON.stringify(await pending)).toContain('remainingPasses\\":0');

      const stopped = await request(running.app)
        .post("/bridge/refinement/stop")
        .set(authorization)
        .expect(200);
      expect(stopped.text).toContain('"stopReason":"stopped-by-user"');
      expect(stopped.text).toContain('"imagesCaptured":1');
      expect(
        JSON.stringify(
          await client.callTool({
            name: "refine_pass",
            arguments: { sessionId },
          }),
        ),
      ).toContain("stopped already");
    } finally {
      await client.close();
      await running.close();
    }
  });
});
