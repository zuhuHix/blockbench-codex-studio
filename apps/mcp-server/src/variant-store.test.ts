import { describe, expect, it } from "vitest";

import {
  VariantStore,
  maxVariants,
  type AddVariantInput,
} from "./variant-store.js";

/** A PNG header whose IHDR color type byte decides the alpha channel. */
function png(colorType: number): string {
  const bytes = Buffer.alloc(26);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "latin1");
  bytes[25] = colorType;
  return bytes.toString("base64");
}

function input(overrides: Partial<AddVariantInput> = {}): AddVariantInput {
  return {
    name: "Lab wall",
    mode: "new-seamless-texture",
    prompt: "mossy lab wall",
    providerId: "comfyui",
    mimeType: "image/png",
    dataBase64: png(6),
    width: 512,
    height: 512,
    ...overrides,
  };
}

describe("variant store", () => {
  it("records provenance and detects a transparency channel", () => {
    const variants = new VariantStore();
    const variant = variants.add(input({ seed: 11, generationMs: 4200 }));
    expect(variant).toMatchObject({
      name: "Lab wall",
      providerId: "comfyui",
      hasAlphaChannel: true,
      favorite: false,
      seed: 11,
      generationMs: 4200,
    });
    expect(variants.payload(variant.id)).toBe(png(6));
  });

  it("reports an opaque color type and JPEG as having no alpha", () => {
    const variants = new VariantStore();
    expect(variants.add(input({ dataBase64: png(2) })).hasAlphaChannel).toBe(
      false,
    );
    expect(
      variants.add(
        input({
          mimeType: "image/jpeg",
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"),
        }),
      ).hasAlphaChannel,
    ).toBe(false);
  });

  it("lists newest first and toggles favorites", () => {
    const variants = new VariantStore();
    const older = variants.add(
      input({ name: "Older", createdAt: new Date("2026-09-02T10:00:00Z") }),
    );
    const newer = variants.add(
      input({ name: "Newer", createdAt: new Date("2026-09-02T10:05:00Z") }),
    );
    expect(variants.list().map((variant) => variant.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(variants.setFavorite(older.id, true).favorite).toBe(true);
    expect(variants.get(older.id).favorite).toBe(true);
  });

  it("evicts the oldest unfavorited variants but keeps favorites", () => {
    const variants = new VariantStore();
    const kept = variants.add(
      input({ name: "Keeper", createdAt: new Date("2026-09-02T09:00:00Z") }),
    );
    variants.setFavorite(kept.id, true);
    for (let index = 0; index <= maxVariants; index += 1)
      variants.add(
        input({
          name: `Variant ${index}`,
          createdAt: new Date(Date.UTC(2026, 8, 2, 10, index)),
        }),
      );
    expect(variants.list()).toHaveLength(maxVariants);
    expect(variants.get(kept.id).favorite).toBe(true);
  });

  it("rejects a payload that does not match its declared format", () => {
    const variants = new VariantStore();
    expect(() =>
      variants.add(
        input({ dataBase64: Buffer.from("nope").toString("base64") }),
      ),
    ).toThrow("not valid image/png");
  });

  it("reports a missing variant by identifier", () => {
    const variants = new VariantStore();
    expect(() => variants.get("absent")).toThrow(
      "Variant absent was not found.",
    );
  });
});
