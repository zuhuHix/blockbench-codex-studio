import type { Bounds3, Vector3 } from "@blockbench-codex/contracts";

export function dimensions(bounds: Bounds3): Vector3 {
  return bounds.max.map((value, axis) => value - bounds.min[axis]!) as Vector3;
}

export function volume(bounds: Bounds3): number {
  return dimensions(bounds).reduce(
    (product, dimension) => product * dimension,
    1,
  );
}

export function translate(bounds: Bounds3, offset: Vector3): Bounds3 {
  return {
    min: bounds.min.map((value, axis) => value + offset[axis]!) as Vector3,
    max: bounds.max.map((value, axis) => value + offset[axis]!) as Vector3,
  };
}

export function overlapsOrTouches(
  a: Bounds3,
  b: Bounds3,
  tolerance = 0,
): boolean {
  return a.min.every(
    (minimum, axis) =>
      minimum <= b.max[axis]! + tolerance &&
      a.max[axis]! + tolerance >= b.min[axis]!,
  );
}

export function containsBounds(
  container: Bounds3,
  candidate: Bounds3,
): boolean {
  return container.min.every(
    (minimum, axis) =>
      minimum <= candidate.min[axis]! &&
      container.max[axis]! >= candidate.max[axis]!,
  );
}
