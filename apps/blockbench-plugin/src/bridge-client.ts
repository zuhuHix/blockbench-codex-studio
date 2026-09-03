import type * as Net from "node:net";
import type { captureSnapshot } from "./snapshot.js";
import type {
  BridgeCommand,
  CommandAcknowledgement,
  ImageReference,
  ImageReferenceRole,
  ImageVariant,
  ImageAlphaInspection,
  MultiViewCapture,
  PixelArtConversion,
  SavedTexture,
  TextureDestination,
} from "@blockbench-codex/contracts";

export interface BridgeSettings {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
}

export function requestJson<T>(
  settings: BridgeSettings,
  path: string,
  method: "GET" | "POST",
  value?: unknown,
): Promise<T> {
  const net = requireNativeModule("net", {
    message:
      "Connect only to the authenticated Blockbench Codex Studio server on 127.0.0.1.",
    optional: false,
  }) as typeof Net | undefined;
  if (net === undefined)
    return Promise.reject(
      new Error("Blockbench network permission was not granted."),
    );
  const body = value === undefined ? "" : JSON.stringify(value);
  const request = [
    `${method} ${path} HTTP/1.1`,
    `Host: ${settings.host}:${settings.port}`,
    `Authorization: Bearer ${settings.token}`,
    "Accept: application/json",
    "Connection: close",
    ...(body === ""
      ? []
      : [
          "Content-Type: application/json",
          `Content-Length: ${Buffer.byteLength(body)}`,
        ]),
    "",
    body,
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: settings.host, port: settings.port },
      () => socket.write(request),
    );
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += String(chunk);
    });
    socket.once("error", reject);
    socket.once("end", () => {
      const separator = response.indexOf("\r\n\r\n");
      const headers = separator < 0 ? response : response.slice(0, separator);
      const responseBody = separator < 0 ? "" : response.slice(separator + 4);
      const status = /^HTTP\/1\.1\s+(\d{3})/u.exec(headers)?.[1];
      const statusCode = status === undefined ? 0 : Number.parseInt(status, 10);
      if (statusCode < 200 || statusCode >= 300) {
        reject(
          new Error(
            `Bridge request failed with HTTP ${statusCode}: ${responseBody}`,
          ),
        );
        return;
      }
      try {
        resolve(
          (responseBody === "" ? undefined : JSON.parse(responseBody)) as T,
        );
      } catch {
        reject(new Error("Bridge returned invalid JSON."));
      }
    });
  });
}

export interface ChatEvent {
  readonly id: number;
  readonly type: "assistant" | "tool" | "status" | "done" | "error";
  readonly text?: string;
  readonly detail?: unknown;
  readonly createdAt: string;
}

export async function createChatSession(
  settings: BridgeSettings,
): Promise<string> {
  const result = await requestJson<{ sessionId: string }>(
    settings,
    "/bridge/chat/sessions",
    "POST",
    {},
  );
  return result.sessionId;
}

export function sendChatMessage(
  settings: BridgeSettings,
  sessionId: string,
  prompt: string,
  model: string,
  effort: string,
): Promise<unknown> {
  return requestJson(settings, `/bridge/chat/${sessionId}/messages`, "POST", {
    prompt,
    model,
    effort,
  });
}

export async function fetchChatEvents(
  settings: BridgeSettings,
  sessionId: string,
  after: number,
): Promise<readonly ChatEvent[]> {
  const result = await requestJson<{ events: ChatEvent[] }>(
    settings,
    `/bridge/chat/${sessionId}/events?after=${after}`,
    "GET",
  );
  return result.events;
}

export function stopChat(
  settings: BridgeSettings,
  sessionId: string,
): Promise<unknown> {
  return requestJson(settings, `/bridge/chat/${sessionId}/stop`, "POST", {});
}

export async function fetchCommands(
  settings: BridgeSettings,
): Promise<readonly BridgeCommand[]> {
  const result = await requestJson<{ commands: BridgeCommand[] }>(
    settings,
    "/bridge/commands",
    "GET",
  );
  return result.commands;
}

export function acknowledgeCommand(
  settings: BridgeSettings,
  acknowledgement: CommandAcknowledgement,
): Promise<unknown> {
  return requestJson(settings, "/bridge/commands/ack", "POST", acknowledgement);
}

type Snapshot = NonNullable<ReturnType<typeof captureSnapshot>>;

export async function publishSnapshot(
  settings: BridgeSettings,
  snapshot: Snapshot,
): Promise<void> {
  await requestJson(settings, "/bridge/snapshot", "POST", snapshot);
}

export async function publishViewCaptures(
  settings: BridgeSettings,
  capture: MultiViewCapture,
): Promise<void> {
  await requestJson(settings, "/bridge/view-captures", "POST", capture);
}

export async function fetchImageVariants(
  settings: BridgeSettings,
): Promise<readonly ImageVariant[]> {
  const result = await requestJson<{ variants: ImageVariant[] }>(
    settings,
    "/bridge/image-variants",
    "GET",
  );
  return result.variants;
}

/** Returns a data URL, because the panel cannot send a bearer header on img. */
export async function fetchVariantDataUrl(
  settings: BridgeSettings,
  variantId: string,
): Promise<string> {
  const result = await requestJson<{
    variant: ImageVariant;
    dataBase64: string;
  }>(settings, `/bridge/image-variants/${variantId}`, "GET");
  return `data:${result.variant.mimeType};base64,${result.dataBase64}`;
}

export function setVariantFavorite(
  settings: BridgeSettings,
  variantId: string,
  favorite: boolean,
): Promise<ImageVariant> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/favorite`,
    "POST",
    { favorite },
  );
}

export function removeVariant(
  settings: BridgeSettings,
  variantId: string,
): Promise<ImageVariant> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/remove`,
    "POST",
    {},
  );
}

export function attachVariantAsReference(
  settings: BridgeSettings,
  variantId: string,
  role: ImageReferenceRole,
): Promise<ImageReference> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/reference`,
    "POST",
    { role },
  );
}

export async function fetchImageReferences(
  settings: BridgeSettings,
): Promise<readonly ImageReference[]> {
  const result = await requestJson<{ references: ImageReference[] }>(
    settings,
    "/bridge/image-references",
    "GET",
  );
  return result.references;
}

export function fetchTextureDestination(
  settings: BridgeSettings,
): Promise<TextureDestination> {
  return requestJson(settings, "/bridge/texture-destination", "GET");
}

export function setTextureDestination(
  settings: BridgeSettings,
  absolutePath: string,
  create = false,
): Promise<TextureDestination> {
  return requestJson(settings, "/bridge/texture-destination", "POST", {
    absolutePath,
    create,
  });
}

export function revealTextureDestination(
  settings: BridgeSettings,
): Promise<{ revealed: string }> {
  return requestJson(
    settings,
    "/bridge/texture-destination/reveal",
    "POST",
    {},
  );
}

export function saveVariant(
  settings: BridgeSettings,
  variantId: string,
  fileName?: string,
): Promise<SavedTexture> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/save`,
    "POST",
    fileName === undefined ? {} : { fileName },
  );
}

export function inspectVariantTransparency(
  settings: BridgeSettings,
  variantId: string,
): Promise<ImageAlphaInspection> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/transparency`,
    "GET",
  );
}

export function convertVariant(
  settings: BridgeSettings,
  variantId: string,
  options: PixelArtConversion,
): Promise<ImageVariant> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/convert`,
    "POST",
    options,
  );
}

export function importVariant(
  settings: BridgeSettings,
  variantId: string,
  applyToSelection: boolean,
): Promise<{ readonly saved: SavedTexture; readonly command: BridgeCommand }> {
  return requestJson(
    settings,
    `/bridge/image-variants/${variantId}/import`,
    "POST",
    { applyToSelection },
  );
}
