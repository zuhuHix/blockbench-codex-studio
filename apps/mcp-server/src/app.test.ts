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
  selection: ["11111111-1111-4111-8111-111111111111"],
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
      ]);
      const result = await client.callTool({
        name: "get_project_summary",
        arguments: {},
      });
      expect(JSON.stringify(result)).toContain(
        '\\"name\\": \\"Specimen Chamber\\"',
      );
    } finally {
      await client.close();
      await running.close();
    }
  });
});
