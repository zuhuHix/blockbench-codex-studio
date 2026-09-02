import { describe, expect, it } from "vitest";
import type { ImageProviderReport } from "@blockbench-codex/contracts";

import { planImageGeneration } from "./image-requests.js";
import { ReferenceStore, maxReferences } from "./reference-store.js";

const pngBase64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString("base64");

function report(
  overrides: Partial<ImageProviderReport> = {},
): ImageProviderReport {
  return {
    providers: [
      {
        id: "comfyui",
        label: "Local ComfyUI",
        available: true,
        detail: "Reachable.",
        credentialSource: "local-service",
        incursApiCost: false,
      },
    ],
    selectedProviderId: "comfyui",
    incursApiCost: false,
    detectedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function storeWith(role: "shape" | "edit-target" = "shape") {
  const references = new ReferenceStore();
  const reference = references.add({
    name: "Viewport",
    source: "viewport",
    role,
    mimeType: "image/png",
    dataBase64: pngBase64,
    width: 768,
    height: 768,
  });
  return { references, reference };
}

describe("reference store", () => {
  it("records provenance and size while keeping payloads internal", () => {
    const { references, reference } = storeWith();
    expect(reference).toMatchObject({
      name: "Viewport",
      source: "viewport",
      role: "shape",
      mimeType: "image/png",
      byteLength: 8,
    });
    expect(JSON.stringify(references.list())).not.toContain(pngBase64);
    expect(references.payload(reference.id)).toBe(pngBase64);
  });

  it("keeps chip names unambiguous", () => {
    const { references } = storeWith();
    const second = references.add({
      name: "Viewport",
      source: "clipboard",
      role: "palette",
      mimeType: "image/png",
      dataBase64: pngBase64,
      width: 16,
      height: 16,
    });
    expect(second.name).toBe("Viewport (2)");
  });

  it("rejects payloads that do not match their declared format", () => {
    const { references } = storeWith();
    expect(() =>
      references.add({
        name: "Fake",
        source: "imported-file",
        role: "palette",
        mimeType: "image/png",
        dataBase64: Buffer.from("not an image").toString("base64"),
        width: 16,
        height: 16,
      }),
    ).toThrow("not valid image/png");
  });

  it("caps the number of attached references", () => {
    const { references } = storeWith();
    for (
      let index = references.list().length;
      index < maxReferences;
      index += 1
    )
      references.add({
        name: `Extra ${index}`,
        source: "imported-file",
        role: "style",
        mimeType: "image/png",
        dataBase64: pngBase64,
        width: 16,
        height: 16,
      });
    expect(() =>
      references.add({
        name: "Overflow",
        source: "imported-file",
        role: "style",
        mimeType: "image/png",
        dataBase64: pngBase64,
        width: 16,
        height: 16,
      }),
    ).toThrow(`At most ${maxReferences}`);
    expect(references.clear()).toBe(maxReferences);
  });
});

describe("image generation planning", () => {
  it("lists each reference and its role for a new texture", () => {
    const { references, reference } = storeWith();
    const plan = planImageGeneration(
      {
        mode: "new-seamless-texture",
        prompt: "mossy lab wall",
        referenceIds: [reference.id],
        size: { width: 512, height: 512 },
        transparentBackground: false,
      },
      references,
      report(),
    );
    expect(plan.dispatchable).toBe(true);
    expect(plan.warnings).toEqual([]);
    expect(plan.references).toEqual([reference]);
    expect(plan.providerId).toBe("comfyui");
    expect(plan.incursApiCost).toBe(false);
  });

  it("blocks an edit mode without exactly one edit target", () => {
    const { references, reference } = storeWith();
    const plan = planImageGeneration(
      {
        mode: "inpaint-region",
        prompt: "patch the seam",
        referenceIds: [reference.id],
        size: { width: 512, height: 512 },
        transparentBackground: false,
      },
      references,
      report(),
    );
    expect(plan.dispatchable).toBe(false);
    expect(plan.warnings[0]).toContain("exactly one reference in the");
  });

  it("accepts an edit mode with its target attached", () => {
    const { references, reference } = storeWith("edit-target");
    const plan = planImageGeneration(
      {
        mode: "edit-current-texture",
        prompt: "darken the mortar",
        referenceIds: [reference.id],
        size: { width: 512, height: 512 },
        transparentBackground: false,
        seed: 7,
      },
      references,
      report(),
    );
    expect(plan.dispatchable).toBe(true);
    expect(plan.seed).toBe(7);
  });

  it("blocks detached and duplicated references", () => {
    const { references, reference } = storeWith();
    references.remove(reference.id);
    const plan = planImageGeneration(
      {
        mode: "concept-reference",
        prompt: "specimen concept",
        referenceIds: [reference.id, reference.id],
        size: { width: 512, height: 512 },
        transparentBackground: false,
      },
      references,
      report(),
    );
    expect(plan.dispatchable).toBe(false);
    expect(plan.warnings).toHaveLength(2);
  });

  it("blocks dispatch when no backend is configured and warns about cost", () => {
    const { references } = storeWith();
    const unconfigured = planImageGeneration(
      {
        mode: "uv-atlas",
        prompt: "atlas layout",
        referenceIds: [],
        size: { width: 512, height: 512 },
        transparentBackground: false,
      },
      references,
      report({ selectedProviderId: null }),
    );
    expect(unconfigured.dispatchable).toBe(false);

    const billable = planImageGeneration(
      {
        mode: "uv-atlas",
        prompt: "atlas layout",
        referenceIds: [],
        size: { width: 512, height: 512 },
        transparentBackground: false,
      },
      references,
      report({ selectedProviderId: "openai-image", incursApiCost: true }),
    );
    expect(billable.dispatchable).toBe(true);
    expect(billable.warnings[0]).toContain("bills your own account");
  });

  it("advises on decal transparency without blocking the request", () => {
    const { references } = storeWith();
    const plan = planImageGeneration(
      {
        mode: "transparent-decal",
        prompt: "warning sticker",
        referenceIds: [],
        size: { width: 256, height: 256 },
        transparentBackground: false,
      },
      references,
      report(),
    );
    expect(plan.dispatchable).toBe(true);
    expect(plan.warnings[0]).toContain("transparentBackground");
  });
});
