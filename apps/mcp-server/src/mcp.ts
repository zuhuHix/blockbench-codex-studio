import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BlockbenchSnapshot } from "@blockbench-codex/contracts";

import type { SnapshotStore } from "./snapshot-store.js";
import type { DraftStore } from "./draft-store.js";
import {
  bounds3Schema,
  cubeFaceNameSchema,
  cubeFaceUvSchema,
  transactionIdSchema,
} from "@blockbench-codex/contracts";
import { z } from "zod";
import {
  inspectConnectivity,
  layoutConnectedChain,
} from "@blockbench-codex/geometry";
import {
  auditUvSeams,
  cubeFaceNames,
  measureUvCoverage,
  normalizeFaceTexelDensity,
  packFaces,
  projectCubeFromAnchor,
  requireSixFaces,
} from "@blockbench-codex/uv";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const draftAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

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

function selectedCubes(snapshot: BlockbenchSnapshot) {
  const selected = new Set(snapshot.selection);
  return snapshot.elements.filter((element) => selected.has(element.id));
}

function requireTextureSize(snapshot: BlockbenchSnapshot) {
  if (snapshot.project.textureSize === undefined)
    throw new Error("The active project did not publish texture dimensions.");
  return snapshot.project.textureSize;
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
      annotations: readOnlyAnnotations,
    },
    () => jsonContent({ server: "ok", blockbench: store.status() }),
  );

  server.registerTool(
    "get_project_summary",
    {
      description:
        "Inspect the active Blockbench project without modifying it.",
      annotations: readOnlyAnnotations,
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
      annotations: readOnlyAnnotations,
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
      annotations: readOnlyAnnotations,
    },
    () => jsonContent(requireSnapshot(store).outline),
  );

  server.registerTool(
    "capture_viewport",
    {
      description:
        "Return the latest viewport capture published by the Blockbench plugin.",
      annotations: readOnlyAnnotations,
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
      annotations: draftAnnotations,
      inputSchema: { label: z.string().min(1).max(120) },
    },
    ({ label }) => jsonContent(drafts.begin(requireSnapshot(store), label)),
  );

  server.registerTool(
    "move_cube_preserve_size",
    {
      description: "Add a size-preserving cube translation to a draft.",
      annotations: draftAnnotations,
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
      annotations: readOnlyAnnotations,
      inputSchema: { transactionId: transactionIdSchema },
    },
    ({ transactionId }) => jsonContent(drafts.get(transactionId)),
  );

  server.registerTool(
    "validate_draft",
    {
      description:
        "Validate staged operations against current project, group, bounds, and dimension invariants.",
      annotations: readOnlyAnnotations,
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
      annotations: draftAnnotations,
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
      annotations: draftAnnotations,
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
      annotations: draftAnnotations,
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
      annotations: readOnlyAnnotations,
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

  server.registerTool(
    "get_cube_face_uvs",
    {
      description: "Inspect all six authoritative face mappings for a cube.",
      annotations: readOnlyAnnotations,
      inputSchema: { elementId: z.string().min(1) },
    },
    ({ elementId }) => {
      const cube = requireSnapshot(store).elements.find(
        (element) => element.id === elementId,
      );
      if (cube === undefined) throw new Error("Cube element was not found.");
      return jsonContent({ elementId, faces: requireSixFaces(cube) });
    },
  );

  server.registerTool(
    "set_face_uv",
    {
      description:
        "Stage a typed texture, UV rectangle, rotation, and enabled state for one cube face.",
      annotations: draftAnnotations,
      inputSchema: {
        transactionId: transactionIdSchema,
        elementId: z.string().min(1),
        face: cubeFaceNameSchema,
        mapping: cubeFaceUvSchema,
      },
    },
    ({ transactionId, elementId, face, mapping }) =>
      jsonContent(
        drafts.setFaceUv(
          requireSnapshot(store),
          transactionId,
          elementId,
          face,
          mapping,
        ),
      ),
  );

  server.registerTool(
    "project_connected_uv",
    {
      description:
        "Stage continuous six-face UV projection from the inferred selected anchor onto every selected target.",
      annotations: draftAnnotations,
      inputSchema: {
        label: z.string().min(1).max(120).default("Project connected UVs"),
      },
    },
    ({ label }) => {
      const snapshot = requireSnapshot(store);
      const selected = selectedCubes(snapshot);
      const layout = layoutConnectedChain(selected);
      let summary = drafts.begin(snapshot, label);
      for (const target of layout.targets) {
        const projected = projectCubeFromAnchor(layout.anchor, target.element);
        for (const face of cubeFaceNames)
          summary = drafts.setFaceUv(
            snapshot,
            summary.transactionId,
            target.element.id,
            face,
            projected[face],
          );
      }
      return jsonContent({
        anchorId: layout.anchor.id,
        targetIds: layout.targets.map(({ element }) => element.id),
        draft: summary,
      });
    },
  );

  server.registerTool(
    "measure_uv_coverage",
    {
      description:
        "Measure unique atlas coverage for the selected cubes without double-counting overlapping islands.",
      annotations: readOnlyAnnotations,
    },
    () => {
      const snapshot = requireSnapshot(store);
      return jsonContent(
        measureUvCoverage(
          selectedCubes(snapshot),
          requireTextureSize(snapshot),
        ),
      );
    },
  );

  server.registerTool(
    "audit_uv_seams",
    {
      description:
        "Compare selected target mappings with continuous world-space projection from the inferred anchor.",
      annotations: readOnlyAnnotations,
      inputSchema: {
        tolerance: z.number().nonnegative().max(1).default(0.001),
      },
    },
    ({ tolerance }) => {
      const selected = selectedCubes(requireSnapshot(store));
      const layout = layoutConnectedChain(selected);
      return jsonContent(
        auditUvSeams(
          layout.anchor,
          layout.targets.map(({ element }) => element),
          tolerance,
        ),
      );
    },
  );

  server.registerTool(
    "pack_uv_islands",
    {
      description:
        "Stage deterministic non-overlapping packing of every enabled face on selected cubes.",
      annotations: draftAnnotations,
      inputSchema: {
        label: z.string().min(1).max(120).default("Pack UV islands"),
        padding: z.number().nonnegative().max(16).default(1),
      },
    },
    ({ label, padding }) => {
      const snapshot = requireSnapshot(store),
        selected = selectedCubes(snapshot);
      const packed = packFaces(selected, requireTextureSize(snapshot), padding);
      let summary = drafts.begin(snapshot, label);
      for (const cube of selected)
        for (const face of cubeFaceNames) {
          const mapping = packed.get(`${cube.id}:${face}`);
          if (mapping !== undefined)
            summary = drafts.setFaceUv(
              snapshot,
              summary.transactionId,
              cube.id,
              face,
              mapping,
            );
        }
      return jsonContent(summary);
    },
  );

  server.registerTool(
    "normalize_texel_density",
    {
      description:
        "Stage a consistent pixels-per-model-unit density for every enabled selected cube face.",
      annotations: draftAnnotations,
      inputSchema: {
        label: z.string().min(1).max(120).default("Normalize texel density"),
        pixelsPerUnit: z.number().positive().max(64),
      },
    },
    ({ label, pixelsPerUnit }) => {
      const snapshot = requireSnapshot(store),
        selected = selectedCubes(snapshot);
      let summary = drafts.begin(snapshot, label);
      for (const cube of selected)
        for (const face of cubeFaceNames) {
          if (requireSixFaces(cube)[face].enabled)
            summary = drafts.setFaceUv(
              snapshot,
              summary.transactionId,
              cube.id,
              face,
              normalizeFaceTexelDensity(cube, face, pixelsPerUnit),
            );
        }
      return jsonContent(summary);
    },
  );

  return server;
}
