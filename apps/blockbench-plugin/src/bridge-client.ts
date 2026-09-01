import * as http from "node:http";
import type { captureSnapshot } from "./snapshot.js";
import type {
  ApplyDraftCommand,
  CommandAcknowledgement,
} from "@blockbench-codex/contracts";

export interface BridgeSettings {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
}

function requestJson<T>(
  settings: BridgeSettings,
  path: string,
  method: "GET" | "POST",
  value?: unknown,
): Promise<T> {
  const body = value === undefined ? undefined : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: settings.host,
        port: settings.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${settings.token}`,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          data += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 300)
            reject(
              new Error(
                `Bridge request failed with HTTP ${response.statusCode ?? 0}.`,
              ),
            );
          else resolve((data === "" ? undefined : JSON.parse(data)) as T);
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

export async function fetchCommands(
  settings: BridgeSettings,
): Promise<readonly ApplyDraftCommand[]> {
  const result = await requestJson<{ commands: ApplyDraftCommand[] }>(
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

export function publishSnapshot(
  settings: BridgeSettings,
  snapshot: Snapshot,
): Promise<void> {
  const body = JSON.stringify(snapshot);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: settings.host,
        port: settings.port,
        path: "/bridge/snapshot",
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        if (response.statusCode === 202) resolve();
        else
          reject(
            new Error(
              `Bridge rejected snapshot with HTTP ${response.statusCode ?? 0}.`,
            ),
          );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}
