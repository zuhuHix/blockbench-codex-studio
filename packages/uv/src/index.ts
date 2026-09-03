import {
  cubeFaceNames,
  type Bounds3,
  type CubeElement,
  type CubeFaceName,
  type CubeFaceUv,
  type CubeFaces,
  type UvRect,
} from "@blockbench-codex/contracts";

export { cubeFaceNames };
export type { CubeFaceName };
export interface TextureSize {
  readonly width: number;
  readonly height: number;
}

const faceAxes: Record<CubeFaceName, readonly [number, number]> = {
  north: [0, 1],
  south: [0, 1],
  east: [2, 1],
  west: [2, 1],
  up: [0, 2],
  down: [0, 2],
};
const dimension = (bounds: Bounds3, axis: number) =>
  bounds.max[axis]! - bounds.min[axis]!;
const normalizedRect = (uv: UvRect): UvRect => [
  Math.min(uv[0], uv[2]),
  Math.min(uv[1], uv[3]),
  Math.max(uv[0], uv[2]),
  Math.max(uv[1], uv[3]),
];

export function requireSixFaces(cube: CubeElement): CubeFaces {
  if (cube.faces === undefined)
    throw new Error(`Cube ${cube.id} has no face mapping snapshot.`);
  for (const face of cubeFaceNames)
    if (cube.faces[face] === undefined)
      throw new Error(`Cube ${cube.id} is missing its ${face} face.`);
  return cube.faces;
}

export function projectFaceFromAnchor(
  anchor: CubeElement,
  target: CubeElement,
  face: CubeFaceName,
): CubeFaceUv {
  const source = requireSixFaces(anchor)[face];
  requireSixFaces(target);
  if (!source.enabled || source.textureId === null) return source;
  const [axisU, axisV] = faceAxes[face];
  const worldU = dimension(anchor.bounds, axisU),
    worldV = dimension(anchor.bounds, axisV);
  if (worldU <= 0 || worldV <= 0) throw new Error("Anchor face has no area.");
  const scaleU = (source.uv[2] - source.uv[0]) / worldU;
  const scaleV = (source.uv[3] - source.uv[1]) / worldV;
  const u0 =
    source.uv[0] +
    (target.bounds.min[axisU]! - anchor.bounds.min[axisU]!) * scaleU;
  const v0 =
    source.uv[1] +
    (target.bounds.min[axisV]! - anchor.bounds.min[axisV]!) * scaleV;
  return {
    ...source,
    uv: [
      u0,
      v0,
      u0 + dimension(target.bounds, axisU) * scaleU,
      v0 + dimension(target.bounds, axisV) * scaleV,
    ],
  };
}

export function projectCubeFromAnchor(
  anchor: CubeElement,
  target: CubeElement,
): CubeFaces {
  return Object.fromEntries(
    cubeFaceNames.map((face) => [
      face,
      projectFaceFromAnchor(anchor, target, face),
    ]),
  ) as CubeFaces;
}

export function measureUvCoverage(
  cubes: readonly CubeElement[],
  texture: TextureSize,
) {
  if (texture.width <= 0 || texture.height <= 0)
    throw new Error("Texture dimensions must be positive.");
  const rects = cubes.flatMap((cube) =>
    cubeFaceNames.flatMap((name) => {
      const face = requireSixFaces(cube)[name];
      if (!face.enabled || face.textureId === null) return [];
      const rect = normalizedRect(face.uv);
      const clipped: UvRect = [
        Math.max(0, rect[0]),
        Math.max(0, rect[1]),
        Math.min(texture.width, rect[2]),
        Math.min(texture.height, rect[3]),
      ];
      return clipped[2] > clipped[0] && clipped[3] > clipped[1]
        ? [clipped]
        : [];
    }),
  );
  const xs = [...new Set(rects.flatMap((rect) => [rect[0], rect[2]]))].sort(
    (a, b) => a - b,
  );
  let coveredPixels = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index]!,
      right = xs[index + 1]!;
    const intervals = rects
      .filter((rect) => rect[0] < right && rect[2] > left)
      .map((rect) => [rect[1], rect[3]] as const)
      .sort((a, b) => a[0] - b[0]);
    let start: number | undefined,
      end = 0;
    for (const interval of intervals) {
      if (start === undefined) [start, end] = interval;
      else if (interval[0] <= end) end = Math.max(end, interval[1]);
      else {
        coveredPixels += (right - left) * (end - start);
        [start, end] = interval;
      }
    }
    if (start !== undefined) coveredPixels += (right - left) * (end - start);
  }
  const atlasPixels = texture.width * texture.height;
  return {
    coveredPixels,
    atlasPixels,
    coveragePercent: (coveredPixels / atlasPixels) * 100,
    mappedFaceCount: rects.length,
  };
}

export function auditUvSeams(
  anchor: CubeElement,
  targets: readonly CubeElement[],
  tolerance = 0.001,
) {
  const seams = targets.flatMap((target) =>
    cubeFaceNames.flatMap((face) => {
      const current = requireSixFaces(target)[face],
        expected = projectFaceFromAnchor(anchor, target, face);
      if (!current.enabled && !expected.enabled) return [];
      const maximumDelta = Math.max(
        ...current.uv.map((value, index) =>
          Math.abs(value - expected.uv[index]!),
        ),
      );
      return current.textureId === expected.textureId &&
        current.rotation === expected.rotation &&
        maximumDelta <= tolerance
        ? []
        : [{ elementId: target.id, face, maximumDelta, current, expected }];
    }),
  );
  return { continuous: seams.length === 0, seamCount: seams.length, seams };
}

export function normalizeFaceTexelDensity(
  cube: CubeElement,
  face: CubeFaceName,
  pixelsPerUnit: number,
): CubeFaceUv {
  if (pixelsPerUnit <= 0) throw new Error("Texel density must be positive.");
  const current = requireSixFaces(cube)[face],
    [axisU, axisV] = faceAxes[face];
  const signU = current.uv[2] < current.uv[0] ? -1 : 1,
    signV = current.uv[3] < current.uv[1] ? -1 : 1;
  return {
    ...current,
    uv: [
      current.uv[0],
      current.uv[1],
      current.uv[0] + dimension(cube.bounds, axisU) * pixelsPerUnit * signU,
      current.uv[1] + dimension(cube.bounds, axisV) * pixelsPerUnit * signV,
    ],
  };
}

export function packFaces(
  cubes: readonly CubeElement[],
  texture: TextureSize,
  padding = 1,
): ReadonlyMap<string, CubeFaceUv> {
  if (padding < 0) throw new Error("UV padding cannot be negative.");
  const packed = new Map<string, CubeFaceUv>();
  let x = padding,
    y = padding,
    rowHeight = 0;
  for (const cube of cubes)
    for (const face of cubeFaceNames) {
      const current = requireSixFaces(cube)[face];
      if (!current.enabled || current.textureId === null) continue;
      const width = Math.abs(current.uv[2] - current.uv[0]),
        height = Math.abs(current.uv[3] - current.uv[1]);
      if (
        width + padding * 2 > texture.width ||
        height + padding * 2 > texture.height
      )
        throw new Error(
          `The ${cube.name} ${face} UV island cannot fit in the atlas.`,
        );
      if (x + width + padding > texture.width) {
        x = padding;
        y += rowHeight + padding;
        rowHeight = 0;
      }
      if (y + height + padding > texture.height)
        throw new Error("UV islands do not fit in the texture atlas.");
      const signU = current.uv[2] < current.uv[0] ? -1 : 1,
        signV = current.uv[3] < current.uv[1] ? -1 : 1;
      packed.set(`${cube.id}:${face}`, {
        ...current,
        uv: [
          signU > 0 ? x : x + width,
          signV > 0 ? y : y + height,
          signU > 0 ? x + width : x,
          signV > 0 ? y + height : y,
        ],
      });
      x += width + padding;
      rowHeight = Math.max(rowHeight, height);
    }
  return packed;
}

const axisNames = ["x", "y", "z"] as const;
/** Direction words for a positive and a negative step along each world axis. */
const axisDirections: Record<number, readonly [string, string]> = {
  0: ["east", "west"],
  1: ["up", "down"],
  2: ["south", "north"],
};
const faceNormals: Record<CubeFaceName, string> = {
  north: "north",
  south: "south",
  east: "east",
  west: "west",
  up: "up",
  down: "down",
};

export interface FaceAxisLayout {
  /** World axis the image axis runs along. */
  readonly axis: "x" | "y" | "z";
  /** Where the image axis points in the world as its value increases. */
  readonly worldDirection: string;
  /** True when the UV rectangle is stored back-to-front on this axis. */
  readonly flipped: boolean;
  /** Texture pixels spent on this axis of the face. */
  readonly pixels: number;
  /** Model units the face spans on this axis. */
  readonly units: number;
  /** Texture pixels per model unit; equal numbers across faces look even. */
  readonly texelDensity: number;
}

/**
 * Where a cube face lives on the atlas and how its texture pixels land in the
 * world, so a painter knows which rectangle to touch and which way is up in it.
 */
export interface FaceLayout {
  readonly elementId: string;
  readonly cubeName: string;
  readonly face: CubeFaceName;
  /** World direction the face points at. */
  readonly facing: string;
  readonly textureId: string | null;
  readonly enabled: boolean;
  readonly rotation: 0 | 90 | 180 | 270;
  /** UV rectangle in texture pixels, ordered [left, top, right, bottom]. */
  readonly rect: UvRect;
  readonly u: FaceAxisLayout;
  readonly v: FaceAxisLayout;
  /** True when the rectangle reaches outside the texture atlas. */
  readonly outsideTexture: boolean;
}

function axisLayout(
  bounds: Bounds3,
  axis: number,
  from: number,
  to: number,
): FaceAxisLayout {
  const units = dimension(bounds, axis);
  const pixels = Math.abs(to - from);
  const flipped = to < from;
  return {
    axis: axisNames[axis]!,
    worldDirection: axisDirections[axis]![flipped ? 1 : 0],
    flipped,
    pixels,
    units,
    texelDensity: units === 0 ? 0 : pixels / units,
  };
}

/**
 * The layout of one face. `u`/`v` follow the same axis convention the
 * projection and packing helpers use: increasing UV tracks increasing world
 * coordinate on that axis unless the rectangle is flipped.
 */
export function describeFaceLayout(
  cube: CubeElement,
  face: CubeFaceName,
  texture: TextureSize,
): FaceLayout {
  const current = requireSixFaces(cube)[face];
  const [axisU, axisV] = faceAxes[face];
  const rect = normalizedRect(current.uv);
  return {
    elementId: cube.id,
    cubeName: cube.name,
    face,
    facing: faceNormals[face],
    textureId: current.textureId,
    enabled: current.enabled,
    rotation: current.rotation,
    rect,
    u: axisLayout(cube.bounds, axisU, current.uv[0], current.uv[2]),
    v: axisLayout(cube.bounds, axisV, current.uv[1], current.uv[3]),
    outsideTexture:
      rect[0] < 0 ||
      rect[1] < 0 ||
      rect[2] > texture.width ||
      rect[3] > texture.height,
  };
}

export function describeCubeLayout(
  cube: CubeElement,
  texture: TextureSize,
): readonly FaceLayout[] {
  return cubeFaceNames.map((face) => describeFaceLayout(cube, face, texture));
}

/** Faces whose atlas rectangles overlap, i.e. faces that share painted pixels. */
export function findFaceOverlaps(layouts: readonly FaceLayout[]): readonly {
  readonly a: { readonly elementId: string; readonly face: CubeFaceName };
  readonly b: { readonly elementId: string; readonly face: CubeFaceName };
  readonly rect: UvRect;
}[] {
  const overlaps = [];
  for (let index = 0; index < layouts.length; index += 1)
    for (let other = index + 1; other < layouts.length; other += 1) {
      const a = layouts[index]!,
        b = layouts[other]!;
      if (!a.enabled || !b.enabled || a.textureId !== b.textureId) continue;
      const rect: UvRect = [
        Math.max(a.rect[0], b.rect[0]),
        Math.max(a.rect[1], b.rect[1]),
        Math.min(a.rect[2], b.rect[2]),
        Math.min(a.rect[3], b.rect[3]),
      ];
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
      overlaps.push({
        a: { elementId: a.elementId, face: a.face },
        b: { elementId: b.elementId, face: b.face },
        rect,
      });
    }
  return overlaps;
}
