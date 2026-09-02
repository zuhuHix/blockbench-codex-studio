import type * as Net from "node:net";
import type { captureSnapshot } from "./snapshot.js";
import type {
  BridgeCommand,
  CommandAcknowledgement,
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
): Promise<unknown> {
  return requestJson(settings, `/bridge/chat/${sessionId}/messages`, "POST", {
    prompt,
    model,
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
