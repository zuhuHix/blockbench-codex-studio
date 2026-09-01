import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BlockbenchSnapshot } from "@blockbench-codex/contracts";

import type { SnapshotStore } from "./snapshot-store.js";
import type { DraftStore } from "./draft-store.js";
import {
  bounds3Schema,
  transactionIdSchema,
} from "@blockbench-codex/contracts";
import { z } from "zod";
import {
  inspectConnectivity,
  layoutConnectedChain,
} from "@blockbench-codex/geometry";

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

export function createMcpServer(
  store: SnapshotStore,
  drafts: DraftStore,
): McpServer {
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

  server.registerTool(
    "begin_draft",
    {
      description: "Begin an isolated, reversible Blockbench edit draft.",
      inputSchema: { label: z.string().min(1).max(120) },
    },
    ({ label }) => jsonContent(drafts.begin(requireSnapshot(store), label)),
  );

  server.registerTool(
    "move_cube_preserve_size",
    {
      description: "Add a size-preserving cube translation to a draft.",
      inputSchema: {
        transactionId: transactionIdSchema,
        elementId: z.string().min(1),
        to: bounds3Schema,
      },
    },
    ({ transactionId, elementId, to }) =>
      jsonContent(
        drafts.move(requireSnapshot(store), transactionId, elementId, to),
      ),
  );

  server.registerTool(
    "get_draft_summary",
    {
      description: "Inspect the exact operations currently staged in a draft.",
      inputSchema: { transactionId: transactionIdSchema },
    },
    ({ transactionId }) => jsonContent(drafts.get(transactionId)),
  );

  server.registerTool(
    "validate_draft",
    {
      description:
        "Validate staged operations against current project, group, bounds, and dimension invariants.",
      inputSchema: { transactionId: transactionIdSchema },
    },
    ({ transactionId }) =>
      jsonContent(drafts.validate(requireSnapshot(store), transactionId)),
  );

  server.registerTool(
    "commit_draft",
    {
      description:
        "Queue a validated draft as one named Blockbench Undo transaction.",
      inputSchema: { transactionId: transactionIdSchema },
    },
    ({ transactionId }) =>
      jsonContent({
        queued: true,
        command: drafts.commit(requireSnapshot(store), transactionId),
      }),
  );

  server.registerTool(
    "discard_draft",
    {
      description:
        "Discard a draft without changing the live Blockbench project.",
      inputSchema: { transactionId: transactionIdSchema },
    },
    ({ transactionId }) => {
      drafts.discard(transactionId);
      return jsonContent({ discarded: true, transactionId });
    },
  );

  server.registerTool(
    "connect_selected_chain",
    {
      description:
        "Infer the anchor among selected cubes and stage a deterministic, size-preserving connected chain in their shared group.",
      inputSchema: {
        label: z.string().min(1).max(120).default("Connect selected chain"),
        overlap: z.number().positive().max(1).default(0.25),
      },
    },
    ({ label, overlap }) => {
      const snapshot = requireSnapshot(store);
      const selectedIds = new Set(snapshot.selection);
      const selected = snapshot.elements.filter((element) =>
        selectedIds.has(element.id),
      );
      const layout = layoutConnectedChain(selected, {
        ...(snapshot.project.bounds === undefined
          ? {}
          : { envelope: snapshot.project.bounds }),
        overlap,
      });
      let summary = drafts.begin(snapshot, label);
      for (const target of layout.targets)
        summary = drafts.move(
          snapshot,
          summary.transactionId,
          target.element.id,
          target.bounds,
        );
      return jsonContent({
        anchorId: layout.anchor.id,
        targetIds: layout.targets.map(({ element }) => element.id),
        connectedEdgeCount: layout.targets.length,
        draft: summary,
      });
    },
  );

  server.registerTool(
    "inspect_connectivity",
    {
      description:
        "Inspect physical overlap/contact and connected components among the currently selected cubes.",
      inputSchema: { tolerance: z.number().nonnegative().max(1).default(0) },
    },
    ({ tolerance }) => {
      const snapshot = requireSnapshot(store);
      const selectedIds = new Set(snapshot.selection);
      const selected = snapshot.elements.filter((element) =>
        selectedIds.has(element.id),
      );
      return jsonContent(inspectConnectivity(selected, tolerance));
    },
  );

  return server;
}
