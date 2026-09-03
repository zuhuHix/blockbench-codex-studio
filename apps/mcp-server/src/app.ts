import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  blockbenchSnapshotSchema,
  commandAcknowledgementSchema,
  multiViewCaptureSchema,
  imageReferenceRoleSchema,
  pixelArtConversionSchema,
} from "@blockbench-codex/contracts";
import type { Express } from "express";
import { z } from "zod";

import { createBearerAuth } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import { SnapshotStore } from "./snapshot-store.js";
import { DraftStore } from "./draft-store.js";
import { ChatManager } from "./chat-manager.js";
import {
  defaultImageProviderProbes,
  detectImageProviders,
  type ImageProviderProbes,
} from "./image-providers.js";
import { ReferenceStore } from "./reference-store.js";
import { VariantStore } from "./variant-store.js";
import { TextureDestinationStore } from "./texture-destinations.js";
import { revealInFileManager } from "./reveal.js";
import { ViewCaptureStore } from "./view-capture-store.js";
import { RefinementStore } from "./refinement-store.js";
import { convertToPixelArt, inspectImageAlpha } from "./image-conversion.js";

const chatMessageSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  effort: z.string().optional(),
});

export interface StudioServerOptions {
  readonly token: string;
  readonly host?: "127.0.0.1";
  readonly port?: number;
  readonly store?: SnapshotStore;
  readonly imageProbes?: ImageProviderProbes;
}

export interface RunningStudioServer {
  readonly app: Express;
  readonly httpServer: Server;
  readonly host: string;
  readonly port: number;
  readonly store: SnapshotStore;
  close(): Promise<void>;
}

export function createStudioApp(
  token: string,
  store = new SnapshotStore(),
  port = 48172,
  imageProbes: ImageProviderProbes = defaultImageProviderProbes,
): Express {
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  const authenticate = createBearerAuth(token);
  const drafts = new DraftStore();
  const chats = new ChatManager();
  const references = new ReferenceStore();
  const variants = new VariantStore();
  const destinations = new TextureDestinationStore();
  const viewCaptures = new ViewCaptureStore();
  const refinements = new RefinementStore();

  app.post("/bridge/chat/sessions", authenticate, (_request, response) => {
    response.status(201).json({ sessionId: chats.create() });
  });

  app.get(
    "/bridge/chat/:sessionId/events",
    authenticate,
    (request, response) => {
      try {
        const afterValue = request.query.after;
        const after =
          typeof afterValue === "string"
            ? Number.parseInt(afterValue, 10) || 0
            : 0;
        response.json({
          events: chats.events(String(request.params.sessionId), after),
        });
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Unknown session.",
        });
      }
    },
  );

  app.post(
    "/bridge/chat/:sessionId/messages",
    authenticate,
    (request, response) => {
      try {
        const message = chatMessageSchema.parse(request.body);
        chats.send(
          String(request.params.sessionId),
          message.prompt,
          message.model ?? "gpt-5.6-terra",
          port,
          token,
          message.effort,
        );
        response.status(202).json({ accepted: true });
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Message rejected.",
        });
      }
    },
  );

  app.post(
    "/bridge/chat/:sessionId/stop",
    authenticate,
    (request, response) => {
      try {
        chats.stop(String(request.params.sessionId));
        response.status(202).json({ accepted: true });
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Unknown session.",
        });
      }
    },
  );

  app.get("/health", authenticate, (_request, response) => {
    response.json({ server: "ok", blockbench: store.status() });
  });

  app.get("/bridge/image-providers", authenticate, (_request, response) => {
    void detectImageProviders(imageProbes).then(
      (report) => response.json(report),
      (error: unknown) =>
        response.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Image provider detection failed.",
        }),
    );
  });

  app.get("/bridge/image-variants", authenticate, (_request, response) => {
    response.json({ variants: variants.list() });
  });

  // The gallery renders through data URLs, so bytes travel as JSON rather
  // than an unauthenticated image URL.
  app.get("/bridge/image-variants/:id", authenticate, (request, response) => {
    const id = String(request.params.id);
    try {
      response.json({
        variant: variants.get(id),
        dataBase64: variants.payload(id),
      });
    } catch (error) {
      response.status(404).json({
        error: error instanceof Error ? error.message : "Variant not found.",
      });
    }
  });

  app.post(
    "/bridge/image-variants/:id/favorite",
    authenticate,
    (request, response) => {
      const favorite = (request.body as { favorite?: unknown }).favorite;
      try {
        response.json(
          variants.setFavorite(String(request.params.id), favorite === true),
        );
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Variant not found.",
        });
      }
    },
  );

  app.post(
    "/bridge/image-variants/:id/remove",
    authenticate,
    (request, response) => {
      try {
        response.json(variants.remove(String(request.params.id)));
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Variant not found.",
        });
      }
    },
  );

  app.post(
    "/bridge/image-variants/:id/reference",
    authenticate,
    (request, response) => {
      const body = request.body as { role?: unknown; name?: unknown };
      try {
        const variant = variants.get(String(request.params.id));
        response.status(201).json(
          references.add({
            name: typeof body.name === "string" ? body.name : variant.name,
            source: "generated-variant",
            role: imageReferenceRoleSchema.parse(body.role),
            mimeType: variant.mimeType,
            dataBase64: variants.payload(variant.id),
            width: variant.width,
            height: variant.height,
          }),
        );
      } catch (error) {
        response.status(400).json({
          error:
            error instanceof Error ? error.message : "Reference was rejected.",
        });
      }
    },
  );

  app.get("/bridge/image-references", authenticate, (_request, response) => {
    response.json({ references: references.list() });
  });

  function activeProject() {
    const snapshot = store.get();
    if (snapshot === undefined)
      throw new Error("Blockbench has not published a project yet.");
    return snapshot.project;
  }

  app.get("/bridge/texture-destination", authenticate, (_request, response) => {
    try {
      const project = activeProject();
      response.json(destinations.status(project.id, project.filePath));
    } catch (error) {
      response.status(409).json({
        error: error instanceof Error ? error.message : "No active project.",
      });
    }
  });

  app.post("/bridge/texture-destination", authenticate, (request, response) => {
    const body = request.body as { absolutePath?: unknown; create?: unknown };
    try {
      const project = activeProject();
      if (typeof body.absolutePath !== "string")
        throw new Error("Provide the absolute texture folder path.");
      response.json(
        destinations.set(project.id, body.absolutePath, {
          create: body.create === true,
          ...(project.filePath === undefined
            ? {}
            : { projectFilePath: project.filePath }),
        }),
      );
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Destination rejected.",
      });
    }
  });

  app.post(
    "/bridge/texture-destination/reveal",
    authenticate,
    (_request, response) => {
      try {
        const project = activeProject();
        const destination = destinations.status(project.id, project.filePath);
        if (destination.absolutePath === null || !destination.exists)
          throw new Error("There is no existing folder to reveal.");
        revealInFileManager(destination.absolutePath);
        response.json({ revealed: destination.absolutePath });
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Reveal failed.",
        });
      }
    },
  );

  app.post(
    "/bridge/image-variants/:id/save",
    authenticate,
    (request, response) => {
      const body = request.body as { fileName?: unknown };
      try {
        const project = activeProject();
        const variant = variants.get(String(request.params.id));
        response.status(201).json(
          destinations.save({
            projectId: project.id,
            projectFilePath: project.filePath,
            fileName:
              typeof body.fileName === "string" && body.fileName.trim() !== ""
                ? body.fileName
                : variant.name,
            bytes: Buffer.from(variants.payload(variant.id), "base64"),
            provenance: {
              variantId: variant.id,
              prompt: variant.prompt,
              mode: variant.mode,
              provider: variant.providerId,
              ...(variant.seed === undefined ? {} : { seed: variant.seed }),
              width: variant.width,
              height: variant.height,
            },
          }),
        );
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Save failed.",
        });
      }
    },
  );

  app.get(
    "/bridge/image-variants/:id/transparency",
    authenticate,
    (request, response) => {
      try {
        const bytes = Buffer.from(
          variants.payload(String(request.params.id)),
          "base64",
        );
        void inspectImageAlpha(bytes).then(
          (inspection) => response.json(inspection),
          (error: unknown) =>
            response.status(400).json({
              error:
                error instanceof Error ? error.message : "Inspection failed.",
            }),
        );
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Variant not found.",
        });
      }
    },
  );

  app.post(
    "/bridge/image-variants/:id/convert",
    authenticate,
    (request, response) => {
      const parsed = pixelArtConversionSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid conversion options." });
        return;
      }
      try {
        const source = variants.get(String(request.params.id));
        void convertToPixelArt(
          Buffer.from(variants.payload(source.id), "base64"),
          parsed.data,
        ).then(
          (converted) =>
            response.status(201).json(
              variants.add({
                name: `${source.name} ${parsed.data.width}x${parsed.data.height}`,
                mode: "pixel-art-conversion",
                prompt: `${source.prompt} Converted with nearest-neighbor scaling and ${parsed.data.manualPalette?.length ?? parsed.data.paletteColors} palette colors.`,
                providerId: source.providerId,
                mimeType: "image/png",
                dataBase64: converted.toString("base64"),
                width: parsed.data.width,
                height: parsed.data.height,
                ...(source.seed === undefined ? {} : { seed: source.seed }),
              }),
            ),
          (error: unknown) =>
            response.status(400).json({
              error:
                error instanceof Error ? error.message : "Conversion failed.",
            }),
        );
      } catch (error) {
        response.status(404).json({
          error: error instanceof Error ? error.message : "Variant not found.",
        });
      }
    },
  );

  app.post(
    "/bridge/image-variants/:id/import",
    authenticate,
    (request, response) => {
      const body = request.body as {
        fileName?: unknown;
        applyToSelection?: unknown;
      };
      try {
        const snapshot = store.get();
        if (snapshot === undefined)
          throw new Error("Blockbench has not published a project yet.");
        const applyToSelection = body.applyToSelection === true;
        if (applyToSelection && snapshot.selection.length === 0)
          throw new Error(
            "Select at least one cube before applying the texture.",
          );
        const variant = variants.get(String(request.params.id));
        const saved = destinations.save({
          projectId: snapshot.project.id,
          projectFilePath: snapshot.project.filePath,
          fileName:
            typeof body.fileName === "string" && body.fileName.trim()
              ? body.fileName
              : variant.name,
          bytes: Buffer.from(variants.payload(variant.id), "base64"),
          provenance: {
            variantId: variant.id,
            prompt: variant.prompt,
            mode: variant.mode,
            provider: variant.providerId,
            ...(variant.seed === undefined ? {} : { seed: variant.seed }),
            width: variant.width,
            height: variant.height,
          },
        });
        response.status(202).json({
          saved,
          command: drafts.importTexture(snapshot, {
            label: applyToSelection
              ? "Import and apply generated texture"
              : "Import generated texture",
            absolutePath: saved.absolutePath,
            textureName: saved.fileName,
            applyElementIds: applyToSelection ? snapshot.selection : [],
          }),
        });
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Import failed.",
        });
      }
    },
  );

  app.post("/bridge/snapshot", authenticate, (request, response) => {
    const parsed = blockbenchSnapshotSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid Blockbench snapshot.",
        issues: parsed.error.issues,
      });
      return;
    }
    store.set(parsed.data);
    response.status(202).json({ accepted: true });
  });

  /** Backs the panel's Stop button for a running auto-refinement. */
  app.get("/bridge/refinement", authenticate, (_request, response) => {
    response.json({ session: refinements.activeSession() ?? null });
  });

  app.post("/bridge/refinement/stop", authenticate, (_request, response) => {
    const active = refinements.activeSession();
    if (active === undefined) {
      response.status(404).json({ error: "No refinement run is active." });
      return;
    }
    response.json(refinements.stop(active.sessionId, "stopped-by-user"));
  });

  app.post("/bridge/view-captures", authenticate, (request, response) => {
    const parsed = multiViewCaptureSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Invalid multi-view capture.",
        issues: parsed.error.issues,
      });
      return;
    }
    viewCaptures.complete(parsed.data);
    response.status(202).json({ accepted: true });
  });

  app.get("/bridge/commands", authenticate, (_request, response) => {
    response.json({ commands: drafts.pending() });
  });

  app.post("/bridge/commands/ack", authenticate, (request, response) => {
    const parsed = commandAcknowledgementSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid command acknowledgement." });
      return;
    }
    const command = drafts
      .pending()
      .find((pending) => pending.commandId === parsed.data.commandId);
    if (
      !parsed.data.success &&
      command !== undefined &&
      "action" in command &&
      command.action === "capture_views"
    )
      viewCaptures.fail(
        command.requestId,
        parsed.data.error ?? "Blockbench could not capture the views.",
      );
    drafts.acknowledge(parsed.data.commandId);
    response.status(202).json({ accepted: true });
  });

  app.post("/mcp", authenticate, async (request, response) => {
    const server = createMcpServer(
      store,
      drafts,
      imageProbes,
      references,
      variants,
      destinations,
      undefined,
      viewCaptures,
      refinements,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.all("/mcp", authenticate, (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  return app;
}

export async function startStudioServer(
  options: StudioServerOptions,
): Promise<RunningStudioServer> {
  const host = options.host ?? "127.0.0.1";
  const store = options.store ?? new SnapshotStore();
  const app = createStudioApp(
    options.token,
    store,
    options.port ?? 48172,
    options.imageProbes ?? defaultImageProviderProbes,
  );
  const httpServer = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(options.port ?? 48172, host, () =>
      resolve(listeningServer),
    );
    listeningServer.once("error", reject);
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unable to determine the MCP server port.");
  }

  return {
    app,
    httpServer,
    host,
    port: address.port,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  };
}
