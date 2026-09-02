import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  blockbenchSnapshotSchema,
  commandAcknowledgementSchema,
  imageReferenceRoleSchema,
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

  app.get("/bridge/commands", authenticate, (_request, response) => {
    response.json({ commands: drafts.pending() });
  });

  app.post("/bridge/commands/ack", authenticate, (request, response) => {
    const parsed = commandAcknowledgementSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid command acknowledgement." });
      return;
    }
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
