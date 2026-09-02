import type {
  Bounds3,
  CubeElement,
  ElementId,
  Vector3,
} from "@blockbench-codex/contracts";

import {
  containsBounds,
  dimensions,
  overlapsOrTouches,
  volume,
} from "./bounds.js";

export interface ConnectedChainLayout {
  readonly anchor: CubeElement;
  readonly targets: readonly { element: CubeElement; bounds: Bounds3 }[];
}

function center(bounds: Bounds3): Vector3 {
  return bounds.min.map(
    (minimum, axis) => (minimum + bounds.max[axis]!) / 2,
  ) as Vector3;
}

function semanticAnchorScore(element: CubeElement): number {
  const name = element.name.toLowerCase();
  const semantic = /main|anchor|center|centre|blob|core/.test(name) ? 1e9 : 0;
  return semantic + volume(element.bounds);
}

export function inferAnchor(elements: readonly CubeElement[]): CubeElement {
  if (elements.length < 2)
    throw new Error(
      "A connected chain requires an anchor and at least one target.",
    );
  return [...elements].sort(
    (a, b) => semanticAnchorScore(b) - semanticAnchorScore(a),
  )[0]!;
}

function dominantDirection(
  anchor: Bounds3,
  targets: readonly CubeElement[],
): Vector3 {
  const anchorCenter = center(anchor);
  const farthest = [...targets].sort((a, b) => {
    const distance = (element: CubeElement) =>
      center(element.bounds).reduce(
        (sum, coordinate, axis) =>
          sum + (coordinate - anchorCenter[axis]!) ** 2,
        0,
      );
    return distance(b) - distance(a);
  })[0]!;
  const delta = center(farthest.bounds).map(
    (coordinate, axis) => coordinate - anchorCenter[axis]!,
  ) as Vector3;
  const axis = delta.reduce(
    (best, value, index) =>
      Math.abs(value) > Math.abs(delta[best]!) ? index : best,
    0,
  );
  const direction: Vector3 = [0, 0, 0];
  direction[axis] = delta[axis]! < 0 ? -1 : 1;
  return direction;
}

export function layoutConnectedChain(
  elements: readonly CubeElement[],
  options: { readonly envelope?: Bounds3; readonly overlap?: number } = {},
): ConnectedChainLayout {
  const anchor = inferAnchor(elements);
  const targets = elements.filter((element) => element.id !== anchor.id);
  if (targets.some((element) => element.parentGroupId !== anchor.parentGroupId))
    throw new Error("All chain elements must belong to the anchor's group.");
  const direction = dominantDirection(anchor.bounds, targets);
  const axis = direction.findIndex((coordinate) => coordinate !== 0);
  const sign = direction[axis]!;
  const anchorCenter = center(anchor.bounds);
  const ordered = [...targets].sort((a, b) => {
    const projection = (element: CubeElement) =>
      (center(element.bounds)[axis]! - anchorCenter[axis]!) * sign;
    return projection(a) - projection(b);
  });
  const overlap = options.overlap ?? 0.25;
  let previous = anchor.bounds;
  const laidOut = ordered.map((element) => {
    const size = dimensions(element.bounds);
    const previousCenter = center(previous);
    const min = size.map(
      (length, currentAxis) => previousCenter[currentAxis]! - length / 2,
    ) as Vector3;
    if (sign > 0) min[axis] = previous.max[axis]! - overlap;
    else min[axis] = previous.min[axis]! - size[axis]! + overlap;
    const bounds: Bounds3 = {
      min,
      max: min.map(
        (coordinate, currentAxis) => coordinate + size[currentAxis]!,
      ) as Vector3,
    };
    if (!overlapsOrTouches(previous, bounds))
      throw new Error(`Unable to connect cube ${element.id}.`);
    if (
      options.envelope !== undefined &&
      !containsBounds(options.envelope, bounds)
    )
      throw new Error(
        `Connected layout would move cube ${element.id} out of bounds.`,
      );
    previous = bounds;
    return { element, bounds };
  });
  return { anchor, targets: laidOut };
}

export function connectedIds(
  layout: ConnectedChainLayout,
): readonly ElementId[] {
  return [layout.anchor.id, ...layout.targets.map(({ element }) => element.id)];
}
