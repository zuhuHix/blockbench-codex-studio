import { randomUUID } from "node:crypto";

import {
  imageReferenceSchema,
  type ImageMimeType,
  type ImageReference,
  type ImageReferenceRole,
  type ImageReferenceSource,
} from "@blockbench-codex/contracts";

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
export const maxReferenceBytes = 8 * 1024 * 1024;

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);

function decodeImage(dataBase64: string, mimeType: ImageMimeType): Buffer {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.byteLength === 0)
    throw new Error("The reference image payload is empty.");
  if (bytes.byteLength > maxReferenceBytes)
    throw new Error(
      `The reference image exceeds the ${maxReferenceBytes} byte limit.`,
    );
  const signature = mimeType === "image/png" ? pngSignature : jpegSignature;
  if (!bytes.subarray(0, signature.byteLength).equals(signature))
    throw new Error(`The reference image payload is not valid ${mimeType}.`);
  return bytes;
}

export class ReferenceStore {
  readonly #records = new Map<string, ReferenceRecord>();

  add(input: AddReferenceInput): ImageReference {
    if (this.#records.size >= maxReferences)
      throw new Error(
        `At most ${maxReferences} references can be attached at once.`,
      );
    const bytes = decodeImage(input.dataBase64, input.mimeType);
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
