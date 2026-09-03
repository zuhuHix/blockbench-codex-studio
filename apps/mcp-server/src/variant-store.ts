import { randomUUID } from "node:crypto";

import {
  imageVariantSchema,
  type ImageGenerationMode,
  type ImageMimeType,
  type ImageProviderId,
  type ImageVariant,
} from "@blockbench-codex/contracts";

import { decodeImagePayload, hasAlphaChannel } from "./image-payload.js";

interface VariantRecord {
  variant: ImageVariant;
  readonly dataBase64: string;
}

export interface AddVariantInput {
  readonly name: string;
  readonly mode: ImageGenerationMode;
  readonly prompt: string;
  readonly providerId: ImageProviderId;
  readonly mimeType: ImageMimeType;
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly requestId?: string;
  readonly seed?: number;
  readonly generationMs?: number;
  readonly createdAt?: Date;
}

/** Older variants are dropped first so a long session cannot grow unbounded. */
export const maxVariants = 24;

export class VariantStore {
  readonly #records = new Map<string, VariantRecord>();

  add(input: AddVariantInput): ImageVariant {
    const bytes = decodeImagePayload(
      input.dataBase64,
      input.mimeType,
      "generated image",
    );
    const variant = imageVariantSchema.parse({
      id: randomUUID(),
      name: input.name.trim(),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      mode: input.mode,
      prompt: input.prompt,
      providerId: input.providerId,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      byteLength: bytes.byteLength,
      hasAlphaChannel: hasAlphaChannel(bytes, input.mimeType),
      ...(input.generationMs === undefined
        ? {}
        : { generationMs: input.generationMs }),
      favorite: false,
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    });
    this.#records.set(variant.id, {
      variant,
      dataBase64: bytes.toString("base64"),
    });
    this.#evict();
    return variant;
  }

  /** Newest first, which is the order the gallery grid renders. */
  list(): readonly ImageVariant[] {
    return [...this.#records.values()]
      .map((record) => record.variant)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(id: string): ImageVariant {
    return this.#record(id).variant;
  }

  payload(id: string): string {
    return this.#record(id).dataBase64;
  }

  setFavorite(id: string, favorite: boolean): ImageVariant {
    const record = this.#record(id);
    record.variant = { ...record.variant, favorite };
    return record.variant;
  }

  remove(id: string): ImageVariant {
    const variant = this.get(id);
    this.#records.delete(id);
    return variant;
  }

  #record(id: string): VariantRecord {
    const record = this.#records.get(id);
    if (record === undefined) throw new Error(`Variant ${id} was not found.`);
    return record;
  }

  /** Favorites survive eviction; they are the results worth keeping. */
  #evict(): void {
    while (this.#records.size > maxVariants) {
      const oldest = [...this.#records.values()]
        .filter((record) => !record.variant.favorite)
        .sort((left, right) =>
          left.variant.createdAt.localeCompare(right.variant.createdAt),
        )[0];
      if (oldest === undefined) return;
      this.#records.delete(oldest.variant.id);
    }
  }
}
