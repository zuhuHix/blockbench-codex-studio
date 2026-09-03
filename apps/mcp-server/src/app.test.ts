import { describe, expect, it } from "vitest";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { blockbenchSnapshotSchema } from "@blockbench-codex/contracts";

import { createStudioApp, startStudioServer } from "./app.js";
import { SnapshotStore } from "./snapshot-store.js";

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

describe("studio HTTP app", () => {
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
});
