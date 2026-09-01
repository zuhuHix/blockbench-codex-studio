import {
  acknowledgeCommand,
  fetchCommands,
  publishSnapshot,
  type BridgeSettings,
} from "./bridge-client.js";
import { captureSnapshot, captureViewport } from "./snapshot.js";
import { applyCommand } from "./command-applier.js";

const tokenStorageKey = "blockbench_codex_studio_token";
let publishTimer: ReturnType<typeof setInterval> | undefined;
let configureAction: Action | undefined;
let captureAction: Action | undefined;
let applyingCommand = false;

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
        Blockbench.showQuickMessage(`Applied: ${command.label}`, 2000);
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
  void publish().catch(() => undefined);
  publishTimer = setInterval(() => {
    void publish().catch(() => undefined);
    const settings = currentSettings();
    if (settings !== undefined)
      void pollCommands(settings).catch(() => undefined);
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
  version: "0.1.0",
  min_version: "5.0.0",
  variant: "desktop",
  onload() {
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
  },
});
