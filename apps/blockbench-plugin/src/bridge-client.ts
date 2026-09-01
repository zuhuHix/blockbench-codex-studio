import * as http from "node:http";
import type { captureSnapshot } from "./snapshot.js";

export interface BridgeSettings {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
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
