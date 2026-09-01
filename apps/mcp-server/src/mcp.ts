import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BlockbenchSnapshot } from "@blockbench-codex/contracts";

import type { SnapshotStore } from "./snapshot-store.js";

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function requireSnapshot(store: SnapshotStore): BlockbenchSnapshot {
  const snapshot = store.get();
  if (snapshot === undefined) {
    throw new Error(
      "Blockbench has not connected or published a project snapshot yet.",
    );
  }
  return snapshot;
}

export function createMcpServer(store: SnapshotStore): McpServer {
  const server = new McpServer({
    name: "blockbench-codex-studio",
    version: "0.1.0",
  });

  server.registerTool(
    "health",
    {
      description:
        "Check MCP server health and the live Blockbench bridge connection.",
    },
    () => jsonContent({ server: "ok", blockbench: store.status() }),
  );

  server.registerTool(
    "get_project_summary",
    {
      description:
        "Inspect the active Blockbench project without modifying it.",
    },
    () => {
      const snapshot = requireSnapshot(store);
      return jsonContent({
        ...snapshot.project,
        elementCount: snapshot.elements.length,
        selectedElementCount: snapshot.selection.length,
        capturedAt: snapshot.capturedAt,
      });
    },
  );

  server.registerTool(
    "get_selection",
    {
      description:
        "Return selected Blockbench element IDs and their current geometry.",
    },
    () => {
      const snapshot = requireSnapshot(store);
      const selected = new Set(snapshot.selection);
      return jsonContent({
        ids: snapshot.selection,
        elements: snapshot.elements.filter((element) =>
          selected.has(element.id),
        ),
      });
    },
  );

  server.registerTool(
    "list_outline",
    {
      description:
        "Return the active Blockbench Outliner hierarchy with authoritative IDs.",
    },
    () => jsonContent(requireSnapshot(store).outline),
  );

  server.registerTool(
    "capture_viewport",
    {
      description:
        "Return the latest viewport capture published by the Blockbench plugin.",
    },
    () => {
      const viewport = requireSnapshot(store).viewport;
      if (viewport === undefined) {
        throw new Error(
          "The current snapshot does not contain a viewport capture.",
        );
      }
      return {
        content: [
          {
            type: "image" as const,
            data: viewport.dataBase64,
            mimeType: viewport.mimeType,
          },
          {
            type: "text" as const,
            text: JSON.stringify({
              width: viewport.width,
              height: viewport.height,
              capturedAt: viewport.capturedAt,
            }),
          },
        ],
      };
    },
  );

  return server;
}
