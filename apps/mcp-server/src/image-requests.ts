import { randomUUID } from "node:crypto";

import {
  imageGenerationPlanSchema,
  type ImageGenerationMode,
  type ImageGenerationPlan,
  type ImageGenerationRequest,
  type ImageProviderReport,
  type ImageReference,
} from "@blockbench-codex/contracts";

import type { ReferenceStore } from "./reference-store.js";

/** Modes that rewrite an existing image and need exactly one edit target. */
const editingModes: ReadonlySet<ImageGenerationMode> = new Set([
  "edit-current-texture",
  "inpaint-region",
  "outpaint-extend",
  "variation",
  "pixel-art-conversion",
]);

interface Warning {
  readonly message: string;
  /** Blocking warnings make the request meaningless or unroutable. */
  readonly blocking: boolean;
}

function resolveReferences(
  request: ImageGenerationRequest,
  references: ReferenceStore,
): { readonly resolved: ImageReference[]; readonly warnings: Warning[] } {
  const resolved: ImageReference[] = [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  for (const id of request.referenceIds) {
    if (seen.has(id)) {
      warnings.push({
        message: `Reference ${id} was listed more than once.`,
        blocking: true,
      });
      continue;
    }
    seen.add(id);
    try {
      resolved.push(references.get(id));
    } catch {
      warnings.push({
        message: `Reference ${id} is no longer attached.`,
        blocking: true,
      });
    }
  }
  return { resolved, warnings };
}

function checkMode(
  request: ImageGenerationRequest,
  resolved: readonly ImageReference[],
): Warning[] {
  const warnings: Warning[] = [];
  const editTargets = resolved.filter(
    (reference) => reference.role === "edit-target",
  );

  if (editingModes.has(request.mode) && editTargets.length !== 1)
    warnings.push({
      message: `Mode ${request.mode} needs exactly one reference in the edit-target role; ${editTargets.length} were listed.`,
      blocking: true,
    });
  if (!editingModes.has(request.mode) && editTargets.length > 0)
    warnings.push({
      message: `Mode ${request.mode} creates a new image, so the edit-target reference is used as a plain reference.`,
      blocking: false,
    });
  if (request.mode === "transparent-decal" && !request.transparentBackground)
    warnings.push({
      message:
        "Decal mode produces a cutout, so transparentBackground should be enabled.",
      blocking: false,
    });
  if (
    request.mode === "pixel-art-conversion" &&
    (request.size.width > 512 || request.size.height > 512)
  )
    warnings.push({
      message:
        "Pixel-art conversion reads best at 512 pixels or less before the nearest-neighbor downscale.",
      blocking: false,
    });
  return warnings;
}

/**
 * Describe exactly what would be sent to the selected provider. Planning is
 * read-only: it contacts no provider and imports nothing into Blockbench.
 */
export function planImageGeneration(
  request: ImageGenerationRequest,
  references: ReferenceStore,
  providers: ImageProviderReport,
  now = new Date(),
): ImageGenerationPlan {
  const { resolved, warnings } = resolveReferences(request, references);
  warnings.push(...checkMode(request, resolved));
  if (providers.selectedProviderId === null)
    warnings.push({
      message:
        "No image generation backend is configured, so this request cannot be sent yet.",
      blocking: true,
    });
  if (providers.incursApiCost)
    warnings.push({
      message: `Provider ${providers.selectedProviderId} bills your own account for this request.`,
      blocking: false,
    });

  return imageGenerationPlanSchema.parse({
    requestId: randomUUID(),
    mode: request.mode,
    prompt: request.prompt,
    size: request.size,
    transparentBackground: request.transparentBackground,
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    providerId: providers.selectedProviderId,
    incursApiCost: providers.incursApiCost,
    references: resolved,
    warnings: warnings.map((warning) => warning.message),
    dispatchable: !warnings.some((warning) => warning.blocking),
    plannedAt: now.toISOString(),
  });
}
