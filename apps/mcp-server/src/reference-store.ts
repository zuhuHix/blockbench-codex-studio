import { randomUUID } from "node:crypto";

import {
  imageReferenceSchema,
  type ImageMimeType,
  type ImageReference,
  type ImageReferenceRole,
  type ImageReferenceSource,
} from "@blockbench-codex/contracts";

import { decodeImagePayload } from "./image-payload.js";

/** Reference bytes never leave the store through a tool result. */
interface ReferenceRecord {
  readonly reference: ImageReference;
  readonly dataBase64: string;
}

export interface AddReferenceInput {
  readonly name: string;
  readonly source: ImageReferenceSource;
  readonly role: ImageReferenceRole;
  readonly mimeType: ImageMimeType;
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly addedAt?: Date;
}

export const maxReferences = 8;

export class ReferenceStore {
  readonly #records = new Map<string, ReferenceRecord>();

  add(input: AddReferenceInput): ImageReference {
    if (this.#records.size >= maxReferences)
      throw new Error(
        `At most ${maxReferences} references can be attached at once.`,
      );
    const bytes = decodeImagePayload(
      input.dataBase64,
      input.mimeType,
      "reference image",
    );
    const reference = imageReferenceSchema.parse({
      id: randomUUID(),
      name: this.#uniqueName(input.name.trim()),
      source: input.source,
      role: input.role,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      byteLength: bytes.byteLength,
      addedAt: (input.addedAt ?? new Date()).toISOString(),
    });
    this.#records.set(reference.id, {
      reference,
      dataBase64: bytes.toString("base64"),
    });
    return reference;
  }

  list(): readonly ImageReference[] {
    return [...this.#records.values()].map((record) => record.reference);
  }

  get(id: string): ImageReference {
    const record = this.#records.get(id);
    if (record === undefined)
      throw new Error(`Reference ${id} is not attached.`);
    return record.reference;
  }

  /** Reads the stored bytes for a provider dispatch. */
  payload(id: string): string {
    const record = this.#records.get(id);
    if (record === undefined)
      throw new Error(`Reference ${id} is not attached.`);
    return record.dataBase64;
  }

  remove(id: string): ImageReference {
    const reference = this.get(id);
    this.#records.delete(id);
    return reference;
  }

  clear(): number {
    const removed = this.#records.size;
    this.#records.clear();
    return removed;
  }

  /** Names stay distinct so chips and prompt lines are never ambiguous. */
  #uniqueName(name: string): string {
    const taken = new Set(
      [...this.#records.values()].map((record) => record.reference.name),
    );
    if (!taken.has(name)) return name;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${name} (${suffix})`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
