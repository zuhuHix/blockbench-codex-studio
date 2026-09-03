import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  ImageGenerationPlan,
  ImageMimeType,
  ImageProviderId,
  ImageReference,
} from "@blockbench-codex/contracts";
import sharp from "sharp";

import type { ReferenceStore } from "./reference-store.js";
import { readWindowsOpenAiCredential } from "./windows-credentials.js";

export interface GeneratedImage {
  readonly dataBase64: string;
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly seed?: number;
}

export interface ImageDispatchDependencies {
  readonly env: Record<string, string | undefined>;
  readonly fetch: typeof fetch;
  readonly readOpenAiCredential: () => Promise<string | undefined>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly runNative: (
    command: string,
    arguments_: readonly string[],
    input: string,
  ) => Promise<string>;
}

async function runNative(
  command: string,
  arguments_: readonly string[],
  input: string,
): Promise<string> {
  const isCmd = command.toLowerCase().endsWith(".cmd");
  const child = spawn(
    isCmd ? (process.env.ComSpec ?? "cmd.exe") : command,
    isCmd ? ["/d", "/c", "call", command, ...arguments_] : [...arguments_],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  child.stdin.end(input);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(stderr.trim() || `Image command exited with ${code}.`),
        );
    });
  });
}

export const defaultImageDispatchDependencies: ImageDispatchDependencies = {
  env: process.env,
  fetch,
  readOpenAiCredential: readWindowsOpenAiCredential,
  readTextFile: (path) => readFile(path, "utf8"),
  wait: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  runNative,
};

function referencePrompt(references: readonly ImageReference[]): string {
  if (references.length === 0) return "";
  return `\n\nReference roles:\n${references
    .map(
      (reference, index) =>
        `${index + 1}. ${reference.name}: ${reference.role}`,
    )
    .join("\n")}`;
}

async function dimensions(bytes: Buffer): Promise<{
  width: number;
  height: number;
}> {
  const metadata = await sharp(bytes).metadata();
  if (metadata.width === undefined || metadata.height === undefined)
    throw new Error("The provider returned an image without dimensions.");
  return { width: metadata.width, height: metadata.height };
}

async function responseError(response: Response): Promise<Error> {
  const detail = (await response.text()).slice(0, 1_000);
  return new Error(
    `Image provider returned HTTP ${response.status}${detail === "" ? "." : `: ${detail}`}`,
  );
}

async function openAiKey(
  dependencies: ImageDispatchDependencies,
): Promise<string> {
  const environment =
    dependencies.env.BLOCKBENCH_CODEX_OPENAI_API_KEY ??
    dependencies.env.OPENAI_API_KEY;
  if (environment?.trim()) return environment.trim();
  const credential = await dependencies.readOpenAiCredential();
  if (credential?.trim()) return credential.trim();
  throw new Error("The configured OpenAI API credential could not be read.");
}

async function dispatchOpenAi(
  plan: ImageGenerationPlan,
  references: ReferenceStore,
  dependencies: ImageDispatchDependencies,
): Promise<GeneratedImage> {
  const key = await openAiKey(dependencies);
  const model =
    dependencies.env.BLOCKBENCH_CODEX_OPENAI_IMAGE_MODEL?.trim() ||
    "gpt-image-2";
  const prompt = `${plan.prompt}${referencePrompt(plan.references)}`;
  let response: Response;
  if (plan.references.length === 0) {
    response = await dependencies.fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          size: `${plan.size.width}x${plan.size.height}`,
          output_format: "png",
          background: plan.transparentBackground ? "transparent" : "opaque",
          n: 1,
        }),
        signal: AbortSignal.timeout(5 * 60_000),
      },
    );
  } else {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", `${plan.size.width}x${plan.size.height}`);
    form.append("output_format", "png");
    form.append(
      "background",
      plan.transparentBackground ? "transparent" : "opaque",
    );
    for (const reference of plan.references)
      form.append(
        "image[]",
        new Blob([Buffer.from(references.payload(reference.id), "base64")], {
          type: reference.mimeType,
        }),
        `${reference.name}.${reference.mimeType === "image/png" ? "png" : "jpg"}`,
      );
    response = await dependencies.fetch(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(5 * 60_000),
      },
    );
  }
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as {
    data?: readonly { b64_json?: string }[];
  };
  const dataBase64 = body.data?.[0]?.b64_json;
  if (dataBase64 === undefined)
    throw new Error("OpenAI returned no image payload.");
  const bytes = Buffer.from(dataBase64, "base64");
  return { dataBase64, mimeType: "image/png", ...(await dimensions(bytes)) };
}

function substituteWorkflow(
  source: string,
  values: Readonly<Record<string, string | number>>,
): unknown {
  let result = source;
  for (const [key, value] of Object.entries(values)) {
    const encoded =
      typeof value === "number"
        ? String(value)
        : JSON.stringify(value).slice(1, -1);
    result = result.replaceAll(`{{${key}}}`, encoded);
  }
  return JSON.parse(result) as unknown;
}

async function uploadComfyReference(
  baseUrl: string,
  reference: ImageReference,
  references: ReferenceStore,
  dependencies: ImageDispatchDependencies,
): Promise<string> {
  const form = new FormData();
  form.append(
    "image",
    new Blob([Buffer.from(references.payload(reference.id), "base64")], {
      type: reference.mimeType,
    }),
    `${reference.id}.${reference.mimeType === "image/png" ? "png" : "jpg"}`,
  );
  form.append("overwrite", "false");
  const response = await dependencies.fetch(new URL("/upload/image", baseUrl), {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as { name?: string; subfolder?: string };
  if (body.name === undefined)
    throw new Error("ComfyUI did not report the uploaded reference name.");
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

async function dispatchComfyUi(
  plan: ImageGenerationPlan,
  references: ReferenceStore,
  dependencies: ImageDispatchDependencies,
): Promise<GeneratedImage> {
  const baseUrl =
    dependencies.env.BLOCKBENCH_CODEX_COMFYUI_URL ?? "http://127.0.0.1:8188";
  const workflowPath =
    dependencies.env.BLOCKBENCH_CODEX_COMFYUI_WORKFLOW?.trim();
  if (!workflowPath)
    throw new Error(
      "Set BLOCKBENCH_CODEX_COMFYUI_WORKFLOW to an API-format workflow JSON file before generating.",
    );
  const uploaded: Record<string, string> = {};
  for (const [index, reference] of plan.references.entries())
    uploaded[`REFERENCE_${index + 1}`] = await uploadComfyReference(
      baseUrl,
      reference,
      references,
      dependencies,
    );
  const workflow = substituteWorkflow(
    await dependencies.readTextFile(workflowPath),
    {
      PROMPT: `${plan.prompt}${referencePrompt(plan.references)}`,
      WIDTH: plan.size.width,
      HEIGHT: plan.size.height,
      SEED: plan.seed ?? Math.floor(Math.random() * 2_147_483_647),
      ...uploaded,
    },
  );
  const queued = await dependencies.fetch(new URL("/prompt", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  });
  if (!queued.ok) throw await responseError(queued);
  const promptId = ((await queued.json()) as { prompt_id?: string }).prompt_id;
  if (promptId === undefined)
    throw new Error("ComfyUI did not return a prompt id.");

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const historyResponse = await dependencies.fetch(
      new URL(`/history/${encodeURIComponent(promptId)}`, baseUrl),
    );
    if (!historyResponse.ok) throw await responseError(historyResponse);
    const history = (await historyResponse.json()) as Record<
      string,
      { outputs?: Record<string, { images?: readonly ComfyImage[] }> }
    >;
    const images = Object.values(history[promptId]?.outputs ?? {}).flatMap(
      (output) => output.images ?? [],
    );
    const image = images[0];
    if (image !== undefined) {
      const url = new URL("/view", baseUrl);
      url.searchParams.set("filename", image.filename);
      if (image.subfolder) url.searchParams.set("subfolder", image.subfolder);
      if (image.type) url.searchParams.set("type", image.type);
      const output = await dependencies.fetch(url);
      if (!output.ok) throw await responseError(output);
      const bytes = Buffer.from(await output.arrayBuffer());
      return {
        dataBase64: bytes.toString("base64"),
        mimeType: "image/png",
        ...(await dimensions(bytes)),
        ...(plan.seed === undefined ? {} : { seed: plan.seed }),
      };
    }
    await dependencies.wait(300);
  }
  throw new Error("ComfyUI generation timed out after five minutes.");
}

interface ComfyImage {
  readonly filename: string;
  readonly subfolder?: string;
  readonly type?: string;
}

async function dispatchCodexNative(
  plan: ImageGenerationPlan,
  references: ReferenceStore,
  dependencies: ImageDispatchDependencies,
): Promise<GeneratedImage> {
  const command =
    dependencies.env.BLOCKBENCH_CODEX_NATIVE_IMAGE_COMMAND?.trim();
  if (!command)
    throw new Error(
      "Set BLOCKBENCH_CODEX_NATIVE_IMAGE_COMMAND to the approved local image adapter executable.",
    );
  let arguments_: readonly string[] = [];
  const configuredArguments =
    dependencies.env.BLOCKBENCH_CODEX_NATIVE_IMAGE_ARGS?.trim();
  if (configuredArguments) {
    const parsed = JSON.parse(configuredArguments) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string")
    )
      throw new Error(
        "BLOCKBENCH_CODEX_NATIVE_IMAGE_ARGS must be a JSON string array.",
      );
    arguments_ = parsed;
  }
  const output = await dependencies.runNative(
    command,
    arguments_,
    JSON.stringify({
      plan,
      references: plan.references.map((reference) => ({
        ...reference,
        dataBase64: references.payload(reference.id),
      })),
    }),
  );
  const parsed = JSON.parse(output) as GeneratedImage;
  const bytes = Buffer.from(parsed.dataBase64, "base64");
  return {
    ...parsed,
    mimeType: "image/png",
    ...(await dimensions(bytes)),
  };
}

const dispatchers: Record<
  ImageProviderId,
  (
    plan: ImageGenerationPlan,
    references: ReferenceStore,
    dependencies: ImageDispatchDependencies,
  ) => Promise<GeneratedImage>
> = {
  "openai-image": dispatchOpenAi,
  comfyui: dispatchComfyUi,
  "codex-native": dispatchCodexNative,
};

export async function dispatchImageGeneration(
  plan: ImageGenerationPlan,
  references: ReferenceStore,
  dependencies: ImageDispatchDependencies = defaultImageDispatchDependencies,
): Promise<GeneratedImage> {
  if (!plan.dispatchable || plan.providerId === null)
    throw new Error(
      `The image request is not dispatchable${plan.warnings.length ? `: ${plan.warnings.join(" ")}` : "."}`,
    );
  return dispatchers[plan.providerId](plan, references, dependencies);
}
