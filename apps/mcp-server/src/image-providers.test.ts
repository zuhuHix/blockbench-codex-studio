import { describe, expect, it } from "vitest";
import { imageProviderReportSchema } from "@blockbench-codex/contracts";

import {
  detectImageProviders,
  type ImageProviderProbes,
} from "./image-providers.js";

function probes(
  overrides: Partial<ImageProviderProbes> = {},
): ImageProviderProbes {
  return {
    env: {},
    codexInstalled: () => false,
    credentialStored: () => Promise.resolve(false),
    comfyUiReachable: () => Promise.resolve(false),
    now: () => new Date("2026-09-02T10:00:00.000Z"),
    ...overrides,
  };
}

describe("image provider detection", () => {
  it("reports every backend and selects none when nothing is configured", async () => {
    const report = await detectImageProviders(probes());
    expect(imageProviderReportSchema.parse(report)).toEqual(report);
    expect(report.providers.map((provider) => provider.id)).toEqual([
      "codex-native",
      "openai-image",
      "comfyui",
    ]);
    expect(report.providers.every((provider) => !provider.available)).toBe(
      true,
    );
    expect(report.selectedProviderId).toBeNull();
    expect(report.incursApiCost).toBe(false);
    expect(report.detectedAt).toBe("2026-09-02T10:00:00.000Z");
  });

  it("never treats an installed Codex CLI alone as image generation access", async () => {
    const report = await detectImageProviders(
      probes({ codexInstalled: () => true }),
    );
    const codex = report.providers[0]!;
    expect(codex.available).toBe(false);
    expect(codex.detail).toContain("BLOCKBENCH_CODEX_NATIVE_IMAGES");
  });

  it("enables Codex-native generation only with the explicit opt-in", async () => {
    const report = await detectImageProviders(
      probes({
        codexInstalled: () => true,
        env: { BLOCKBENCH_CODEX_NATIVE_IMAGES: "1" },
      }),
    );
    expect(report.selectedProviderId).toBe("codex-native");
    expect(report.incursApiCost).toBe(false);
  });

  it("flags an environment OpenAI key as billable without echoing it", async () => {
    const report = await detectImageProviders(
      probes({ env: { OPENAI_API_KEY: "sk-secret-value" } }),
    );
    const openai = report.providers[1]!;
    expect(openai.available).toBe(true);
    expect(openai.credentialSource).toBe("environment");
    expect(report.selectedProviderId).toBe("openai-image");
    expect(report.incursApiCost).toBe(true);
    expect(JSON.stringify(report)).not.toContain("sk-secret-value");
  });

  it("accepts a Windows Credential Manager entry as configuration", async () => {
    const report = await detectImageProviders(
      probes({ credentialStored: () => Promise.resolve(true) }),
    );
    expect(report.providers[1]!.credentialSource).toBe(
      "windows-credential-manager",
    );
    expect(report.selectedProviderId).toBe("openai-image");
  });

  it("prefers a free local ComfyUI instance over the billable API", async () => {
    const seen: string[] = [];
    const report = await detectImageProviders(
      probes({
        env: {
          OPENAI_API_KEY: "sk-secret-value",
          BLOCKBENCH_CODEX_COMFYUI_URL: "http://127.0.0.1:9000",
        },
        comfyUiReachable: (baseUrl) => {
          seen.push(baseUrl);
          return Promise.resolve(true);
        },
      }),
    );
    expect(seen).toEqual(["http://127.0.0.1:9000"]);
    expect(report.selectedProviderId).toBe("comfyui");
    expect(report.incursApiCost).toBe(false);
  });
});
