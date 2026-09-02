import {
  acknowledgeCommand,
  fetchCommands,
  publishSnapshot,
  requestJson,
  type BridgeSettings,
} from "./bridge-client.js";
import type * as ChildProcess from "node:child_process";
import type * as NodeProcess from "node:process";
import { captureSnapshot, captureViewport } from "./snapshot.js";
import { applyCommand } from "./command-applier.js";
import { createAssistantPanel } from "./assistant-panel.js";

const tokenStorageKey = "blockbench_codex_studio_token";
let publishTimer: ReturnType<typeof setInterval> | undefined;
let configureAction: Action | undefined;
let captureAction: Action | undefined;
let applyingCommand = false;
let assistantPanel: Panel | undefined;
let assistantStyles: { delete(): void } | undefined;
let companionStart: Promise<void> | undefined;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureCompanion(settings: BridgeSettings): Promise<void> {
  try {
    await requestJson(settings, "/health", "GET");
    return;
  } catch {
    // The saved local bridge is absent; start the companion below.
  }
  const childProcess = requireNativeModule("child_process", {
    message:
      "Start the local Blockbench Codex Studio companion without opening a terminal window.",
    optional: false,
  }) as typeof ChildProcess | undefined;
  if (childProcess === undefined)
    throw new Error("Blockbench process permission was not granted.");
  const nodeProcess = requireNativeModule("process", {
    message:
      "Pass the saved local bridge token only to the Codex Studio companion process.",
    optional: false,
  }) as typeof NodeProcess | undefined;
  if (nodeProcess === undefined)
    throw new Error(
      "Blockbench process-environment permission was not granted.",
    );
  const companion = childProcess.spawn("node", [__STUDIO_SERVER_SCRIPT__], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...nodeProcess.env,
      BLOCKBENCH_CODEX_TOKEN: settings.token,
      BLOCKBENCH_CODEX_PORT: String(settings.port),
    },
  });
  companion.once("error", () => undefined);
  companion.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    try {
      await requestJson(settings, "/health", "GET");
      return;
    } catch {
      // Allow the TypeScript companion a bounded startup window.
    }
  }
  throw new Error("The local Codex Studio companion did not start.");
}

function connectCompanion(settings: BridgeSettings): Promise<void> {
  companionStart ??= ensureCompanion(settings).finally(() => {
    companionStart = undefined;
  });
  return companionStart;
}

async function pollCommands(settings: BridgeSettings): Promise<void> {
  if (applyingCommand) return;
  applyingCommand = true;
  try {
    for (const command of await fetchCommands(settings)) {
      try {
        applyCommand(command);
        await publish(true);
        await acknowledgeCommand(settings, {
          commandId: command.commandId,
          success: true,
        });
        Blockbench.showQuickMessage(
          `Applied: ${"label" in command ? command.label : "Selection updated"}`,
          2000,
        );
      } catch (error) {
        await acknowledgeCommand(settings, {
          commandId: command.commandId,
          success: false,
          error: error instanceof Error ? error.message : "Command failed.",
        });
        throw error;
      }
    }
  } finally {
    applyingCommand = false;
  }
}

function currentSettings(): BridgeSettings | undefined {
  const token = localStorage.getItem(tokenStorageKey);
  return token === null || token.length < 32
    ? undefined
    : { host: "127.0.0.1", port: 48172, token };
}

async function publish(includeViewport = false): Promise<void> {
  const settings = currentSettings();
  const viewport = includeViewport ? await captureViewport() : undefined;
  const snapshot = captureSnapshot(viewport);
  if (settings !== undefined && snapshot !== undefined)
    await publishSnapshot(settings, snapshot);
}

function beginPublishing(): void {
  if (publishTimer !== undefined) clearInterval(publishTimer);
  const settings = currentSettings();
  if (settings !== undefined) {
    void connectCompanion(settings)
      .then(() => publish())
      .catch((error: unknown) =>
        Blockbench.showQuickMessage(
          error instanceof Error ? error.message : String(error),
          5000,
        ),
      );
  }
  publishTimer = setInterval(() => {
    const settings = currentSettings();
    if (settings !== undefined) {
      void publish().catch(() =>
        connectCompanion(settings)
          .then(() => publish())
          .catch(() => undefined),
      );
      void pollCommands(settings).catch(() => undefined);
    }
  }, 1_000);
}

function showConfiguration(): void {
  const dialog = new Dialog({
    id: "blockbench_codex_studio_connection",
    title: "Blockbench Codex Studio Connection",
    form: {
      token: {
        label: "Bearer token",
        type: "password",
        value: localStorage.getItem(tokenStorageKey) ?? "",
      },
    },
    onConfirm: (result) => {
      const token = typeof result.token === "string" ? result.token.trim() : "";
      if (token.length < 32) {
        Blockbench.showQuickMessage(
          "Token must contain at least 32 characters.",
          3000,
        );
        return;
      }
      localStorage.setItem(tokenStorageKey, token);
      dialog.hide();
      beginPublishing();
      Blockbench.showQuickMessage("Codex Studio bridge configured.", 2500);
    },
  });
  dialog.show();
}

Plugin.register("blockbench_codex_studio", {
  title: "Blockbench Codex Studio",
  author: "Blockbench Codex Studio contributors",
  description:
    "Safe, typed Blockbench inspection and modeling through Codex MCP.",
  icon: "smart_toy",
  version: "0.2.0",
  min_version: "5.0.0",
  variant: "desktop",
  onload() {
    const assistant = createAssistantPanel(currentSettings, showConfiguration);
    assistantPanel = assistant.panel;
    assistantStyles = assistant.styles;
    configureAction = new Action("blockbench_codex_configure", {
      name: "Configure Codex Studio",
      description: "Set the local MCP bridge bearer token.",
      icon: "settings_ethernet",
      click: showConfiguration,
    });
    captureAction = new Action("blockbench_codex_capture", {
      name: "Capture Viewport for Codex",
      description: "Publish the active project and a 768x768 viewport capture.",
      icon: "photo_camera",
      click: () => {
        void publish(true)
          .then(() =>
            Blockbench.showQuickMessage(
              "Viewport published to Codex Studio.",
              2000,
            ),
          )
          .catch((error: unknown) =>
            Blockbench.showQuickMessage(
              error instanceof Error ? error.message : String(error),
              6000,
            ),
          );
      },
    });
    MenuBar.menus.tools.addAction(configureAction);
    MenuBar.menus.tools.addAction(captureAction);
    if (currentSettings() === undefined) showConfiguration();
    else beginPublishing();
  },
  onunload() {
    if (publishTimer !== undefined) clearInterval(publishTimer);
    configureAction?.delete();
    captureAction?.delete();
    assistantPanel?.delete();
    assistantStyles?.delete();
  },
});
