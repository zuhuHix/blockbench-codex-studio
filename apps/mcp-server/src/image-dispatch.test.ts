import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import type { ImageGenerationPlan } from "@blockbench-codex/contracts";

import {
  dispatchImageGeneration,
  type ImageDispatchDependencies,
} from "./image-dispatch.js";
import { ReferenceStore } from "./reference-store.js";

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 3,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function plan(
  overrides: Partial<ImageGenerationPlan> = {},
): ImageGenerationPlan {
  return {
    requestId: "request-1",
    mode: "new-seamless-texture",
    prompt: "Dark organic culture texture",
    size: { width: 64, height: 64 },
    transparentBackground: false,
    providerId: "openai-image",
    incursApiCost: true,
    references: [],
    warnings: [],
    dispatchable: true,
    plannedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<ImageDispatchDependencies>,
): ImageDispatchDependencies {
  return {
    env: {},
    fetch: vi.fn(),
    readOpenAiCredential: () => Promise.resolve(undefined),
    readTextFile: () => Promise.reject(new Error("Unexpected file read.")),
    wait: () => Promise.resolve(),
    runNative: () => Promise.reject(new Error("Unexpected native command.")),
    ...overrides,
  };
}

describe("image provider dispatch", () => {
  it("sends a generation request to OpenAI and reads actual output dimensions", async () => {
    const png = await tinyPng();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await dispatchImageGeneration(
      plan(),
      new ReferenceStore(),
      dependencies({ env: { OPENAI_API_KEY: "secret" }, fetch: fetchMock }),
    );

    expect(result).toMatchObject({
      mimeType: "image/png",
      width: 2,
      height: 3,
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    const body = options?.body;
    expect(typeof body).toBe("string");
    if (typeof body !== "string")
      throw new Error("Expected JSON request body.");
    expect(JSON.parse(body)).toMatchObject({
      model: "gpt-image-2",
      size: "64x64",
      output_format: "png",
      background: "opaque",
    });
  });

  it("uses the edits endpoint and labels every reference role", async () => {
    const png = await tinyPng();
    const references = new ReferenceStore();
    const reference = references.add({
      name: "Stage 3 silhouette",
      source: "viewport",
      role: "shape",
      mimeType: "image/png",
      dataBase64: png.toString("base64"),
      width: 2,
      height: 3,
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
        { status: 200 },
      ),
    );
    await dispatchImageGeneration(
      plan({ references: [reference] }),
      references,
      dependencies({ env: { OPENAI_API_KEY: "secret" }, fetch: fetchMock }),
    );

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const form = options?.body as FormData;
    expect(form.get("prompt")).toContain("1. Stage 3 silhouette: shape");
    expect(form.getAll("image[]")).toHaveLength(1);
  });

  it("submits a configured ComfyUI workflow and downloads its first image", async () => {
    const png = await tinyPng();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ prompt_id: "job-1" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "job-1": {
              outputs: {
                "9": {
                  images: [
                    { filename: "result.png", subfolder: "", type: "output" },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(png), { status: 200 }),
      );
    const result = await dispatchImageGeneration(
      plan({ providerId: "comfyui", incursApiCost: false, seed: 42 }),
      new ReferenceStore(),
      dependencies({
        env: {
          BLOCKBENCH_CODEX_COMFYUI_URL: "http://127.0.0.1:8188",
          BLOCKBENCH_CODEX_COMFYUI_WORKFLOW: "workflow.json",
        },
        fetch: fetchMock,
        readTextFile: () =>
          Promise.resolve(
            '{"1":{"class_type":"Test","inputs":{"text":"{{PROMPT}}","seed":{{SEED}},"width":{{WIDTH}},"height":{{HEIGHT}}}}}',
          ),
      }),
    );

    expect(result).toMatchObject({ width: 2, height: 3, seed: 42 });
    expect(requestUrl(fetchMock.mock.calls[0]![0])).toBe(
      "http://127.0.0.1:8188/prompt",
    );
    expect(requestUrl(fetchMock.mock.calls[2]![0])).toContain(
      "/view?filename=result.png",
    );
  });

  it("refuses a blocked plan without contacting a provider", async () => {
    const fetchMock = vi.fn();
    await expect(
      dispatchImageGeneration(
        plan({ dispatchable: false, warnings: ["No provider."] }),
        new ReferenceStore(),
        dependencies({ fetch: fetchMock }),
      ),
    ).rejects.toThrow("No provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
