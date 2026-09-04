interface OutlineSnapshotNode {
  readonly id: string;
  readonly name: string;
  readonly type: "group" | "cube" | "mesh" | "other";
  readonly origin?: readonly number[];
  readonly children: readonly OutlineSnapshotNode[];
}

interface ViewportSnapshot {
  readonly mimeType: "image/png" | "image/jpeg";
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: string;
}

function serializeOutline(node: BlockbenchNode): OutlineSnapshotNode {
  const type =
    node.type === "group" || node.type === "cube" || node.type === "mesh"
      ? node.type
      : "other";
  // Group pivots drive rotation, so they are published: without them nothing
  // outside Blockbench can read or safely guard a change to an origin.
  return {
    id: node.uuid,
    name: node.name,
    type,
    ...(type === "group" && node.origin !== undefined
      ? { origin: [...node.origin] }
      : {}),
    children: (node.children ?? []).map(serializeOutline),
  };
}

const faceNames = ["north", "south", "east", "west", "up", "down"] as const;

export function serializeFace(
  face:
    | {
        readonly uv?: readonly number[];
        readonly texture?: string | number | false | null;
        readonly rotation?: number;
        readonly enabled?: boolean;
      }
    | undefined,
) {
  const hasTexture =
    face?.texture !== false &&
    face?.texture !== null &&
    face?.texture !== undefined;
  const uv = face?.uv;
  return {
    textureId: hasTexture ? String(face.texture) : null,
    uv: uv?.length === 4 ? [...uv] : [0, 0, 0, 0],
    rotation:
      face?.rotation === 90 || face?.rotation === 180 || face?.rotation === 270
        ? face.rotation
        : 0,
    enabled: hasTexture && (face.enabled ?? true),
  };
}

function serializeFaces(cube: BlockbenchNode) {
  if (cube.faces === undefined) return undefined;
  return Object.fromEntries(
    faceNames.map((name) => [name, serializeFace(cube.faces?.[name])]),
  );
}

/**
 * Textures big enough to bloat every snapshot ship without pixels; the server
 * then tells the model that texture cannot be read or painted through the
 * bridge instead of silently painting the wrong thing.
 */
const maximumPublishedTexturePixels = 1024 * 1024;

function serializeTexture(texture: BlockbenchTexture) {
  const width = texture.width ?? texture.uv_width;
  const height = texture.height ?? texture.uv_height;
  if (width === undefined || height === undefined) return undefined;
  const base64 =
    texture.getBase64?.() ??
    /^data:image\/png;base64,(.+)$/s.exec(texture.source ?? "")?.[1];
  return {
    id: texture.uuid,
    name: texture.name,
    width,
    height,
    ...(base64 === undefined || width * height > maximumPublishedTexturePixels
      ? {}
      : { dataBase64: base64 }),
  };
}

/** Kept in line with the plugin manifest version in `index.ts`. */
export const pluginVersion = "0.2.0";

export function captureSnapshot(viewport?: ViewportSnapshot) {
  if (Project === undefined) return undefined;
  return {
    bridgeVersion: 1 as const,
    project: {
      id: Project.uuid ?? Project.name ?? "untitled-project",
      name: Project.name ?? "Untitled Blockbench Project",
      formatId: Project.format?.id ?? "unknown",
      ...(Project.save_path === undefined || Project.save_path === ""
        ? {}
        : { filePath: Project.save_path }),
      ...(Project.texture_width !== undefined &&
      Project.texture_height !== undefined
        ? {
            textureSize: {
              width: Project.texture_width,
              height: Project.texture_height,
            },
          }
        : {}),
    },
    selection: Outliner.selected.map((node) => node.uuid),
    outline: Outliner.root.map(serializeOutline),
    elements: Cube.all
      .filter(
        (
          cube,
        ): cube is BlockbenchNode & {
          readonly from: readonly [number, number, number];
          readonly to: readonly [number, number, number];
        } => cube.from !== undefined && cube.to !== undefined,
      )
      .map((cube) => ({
        id: cube.uuid,
        name: cube.name,
        parentGroupId:
          cube.parent === undefined || cube.parent === "root"
            ? "root"
            : cube.parent.uuid,
        bounds: { min: [...cube.from], max: [...cube.to] },
        rotation: cube.rotation === undefined ? [0, 0, 0] : [...cube.rotation],
        visible: cube.visibility ?? true,
        ...(serializeFaces(cube) === undefined
          ? {}
          : { faces: serializeFaces(cube) }),
      })),
    textures: Texture.all
      .map(serializeTexture)
      .filter(
        (texture): texture is NonNullable<typeof texture> =>
          texture !== undefined,
      ),
    ...(viewport === undefined ? {} : { viewport }),
    pluginVersion,
    ...(typeof Blockbench.version === "string" && Blockbench.version !== ""
      ? { blockbenchVersion: Blockbench.version }
      : {}),
    capturedAt: new Date().toISOString(),
  };
}

export function captureViewport(): Promise<ViewportSnapshot | undefined> {
  const preview = Preview.selected;
  if (preview === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    preview.screenshot({ width: 768, height: 768 }, (dataUrl) => {
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/s.exec(dataUrl);
      resolve(
        match === null
          ? undefined
          : {
              mimeType: match[1] as "image/png" | "image/jpeg",
              dataBase64: match[2]!,
              width: 768,
              height: 768,
              capturedAt: new Date().toISOString(),
            },
      );
    });
  });
}
