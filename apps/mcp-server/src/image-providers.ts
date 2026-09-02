import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  ImageProviderId,
  ImageProviderReport,
  ImageProviderStatus,
} from "@blockbench-codex/contracts";

const defaultComfyUiUrl = "http://127.0.0.1:8188";
const credentialTarget = "BlockbenchCodexStudio:OpenAI";
const probeTimeoutMs = 1500;

export interface ImageProviderProbes {
  readonly env: Record<string, string | undefined>;
  /** True when the Codex CLI is installed for this user. */
  codexInstalled(): boolean;
  /** True when Windows Credential Manager holds the OpenAI target. */
  credentialStored(): Promise<boolean>;
  /** True when a local ComfyUI instance answers on its HTTP API. */
  comfyUiReachable(baseUrl: string): Promise<boolean>;
  now(): Date;
}

function codexInstalled(): boolean {
  const appData = process.env.APPDATA;
  if (appData === undefined) return false;
  return existsSync(
    join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
  );
}

async function credentialStored(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("cmdkey", [`/list:${credentialTarget}`], (error, stdout) => {
      resolve(error === null && stdout.includes(credentialTarget));
    });
  });
}

async function comfyUiReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/system_stats", baseUrl), {
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const defaultImageProviderProbes: ImageProviderProbes = {
  env: process.env,
  codexInstalled,
  credentialStored,
  comfyUiReachable,
  now: () => new Date(),
};

function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function detectCodexNative(probes: ImageProviderProbes): ImageProviderStatus {
  const label = "Codex-native image generation";
  if (!probes.codexInstalled())
    return {
      id: "codex-native",
      label,
      available: false,
      detail: "The Codex CLI is not installed for this user.",
      credentialSource: "none",
      incursApiCost: false,
    };
  if (!isEnabled(probes.env.BLOCKBENCH_CODEX_NATIVE_IMAGES))
    return {
      id: "codex-native",
      label,
      available: false,
      detail:
        "A Codex or ChatGPT login does not by itself grant image generation. Set BLOCKBENCH_CODEX_NATIVE_IMAGES=1 once the active Codex session is confirmed to expose it.",
      credentialSource: "none",
      incursApiCost: false,
    };
  return {
    id: "codex-native",
    label,
    available: true,
    detail:
      "The Codex CLI is installed and image generation is enabled for this session.",
    credentialSource: "environment",
    incursApiCost: false,
  };
}

async function detectOpenAiImage(
  probes: ImageProviderProbes,
): Promise<ImageProviderStatus> {
  const label = "OpenAI GPT Image";
  const envKey =
    probes.env.BLOCKBENCH_CODEX_OPENAI_API_KEY ?? probes.env.OPENAI_API_KEY;
  if (envKey !== undefined && envKey.trim().length > 0)
    return {
      id: "openai-image",
      label,
      available: true,
      detail:
        "An OpenAI API key is configured in the environment. Requests bill your own OpenAI account.",
      credentialSource: "environment",
      incursApiCost: true,
    };
  if (await probes.credentialStored())
    return {
      id: "openai-image",
      label,
      available: true,
      detail: `Windows Credential Manager holds the ${credentialTarget} entry. Requests bill your own OpenAI account.`,
      credentialSource: "windows-credential-manager",
      incursApiCost: true,
    };
  return {
    id: "openai-image",
    label,
    available: false,
    detail: `No API key found. Set BLOCKBENCH_CODEX_OPENAI_API_KEY or store the ${credentialTarget} entry in Windows Credential Manager.`,
    credentialSource: "none",
    incursApiCost: true,
  };
}

async function detectComfyUi(
  probes: ImageProviderProbes,
): Promise<ImageProviderStatus> {
  const label = "Local ComfyUI";
  const baseUrl = probes.env.BLOCKBENCH_CODEX_COMFYUI_URL ?? defaultComfyUiUrl;
  if (await probes.comfyUiReachable(baseUrl))
    return {
      id: "comfyui",
      label,
      available: true,
      detail: `A local ComfyUI instance answered at ${baseUrl}. Generation runs on this machine at no API cost.`,
      credentialSource: "local-service",
      incursApiCost: false,
    };
  return {
    id: "comfyui",
    label,
    available: false,
    detail: `No ComfyUI instance answered at ${baseUrl}. Set BLOCKBENCH_CODEX_COMFYUI_URL to use another address.`,
    credentialSource: "none",
    incursApiCost: false,
  };
}

/** Cost-free backends win, so nothing bills the user without a clear reason. */
const selectionOrder: readonly ImageProviderId[] = [
  "codex-native",
  "comfyui",
  "openai-image",
];

export async function detectImageProviders(
  probes: ImageProviderProbes = defaultImageProviderProbes,
): Promise<ImageProviderReport> {
  const providers = [
    detectCodexNative(probes),
    await detectOpenAiImage(probes),
    await detectComfyUi(probes),
  ];
  const selected = selectionOrder
    .map((id) => providers.find((provider) => provider.id === id))
    .find((provider) => provider?.available === true);

  return {
    providers,
    selectedProviderId: selected?.id ?? null,
    incursApiCost: selected?.incursApiCost ?? false,
    detectedAt: probes.now().toISOString(),
  };
}
