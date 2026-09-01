import { describe, expect, it } from "vitest";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { blockbenchSnapshotSchema } from "@blockbench-codex/contracts";

import { createStudioApp, startStudioServer } from "./app.js";

const token = "test-token-that-is-at-least-32-characters-long";
const authorization = { Authorization: `Bearer ${token}` };

const snapshot = blockbenchSnapshotSchema.parse({
  bridgeVersion: 1,
  project: { id: "specimen", name: "Specimen Chamber", formatId: "free" },
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
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "tentacle_west_1",
      parentGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bounds: { min: [2, 2, 7], max: [4, 3, 8] },
      rotation: [0, 0, 0],
      visible: true,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "tentacle_west_2",
      parentGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bounds: { min: [-1, 2, 7], max: [1, 3, 8] },
      rotation: [0, 0, 0],
      visible: true,
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

  it("rejects malformed snapshots", async () => {
    const app = createStudioApp(token);
    await request(app)
      .post("/bridge/snapshot")
      .set(authorization)
      .send({ project: { name: "missing fields" } })
      .expect(400);
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
        "list_outline",
        "capture_viewport",
        "begin_draft",
        "move_cube_preserve_size",
        "get_draft_summary",
        "validate_draft",
        "commit_draft",
        "discard_draft",
        "connect_selected_chain",
        "inspect_connectivity",
      ]);
      const result = await client.callTool({
        name: "get_project_summary",
        arguments: {},
      });
      expect(JSON.stringify(result)).toContain(
        '\\"name\\": \\"Specimen Chamber\\"',
      );

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
    } finally {
      await client.close();
      await running.close();
    }
  });
});
