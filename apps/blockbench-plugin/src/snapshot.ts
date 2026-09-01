interface OutlineSnapshotNode {
  readonly id: string;
  readonly name: string;
  readonly type: "group" | "cube" | "mesh" | "other";
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
  return {
    id: node.uuid,
    name: node.name,
    type,
    children: (node.children ?? []).map(serializeOutline),
  };
}

export function captureSnapshot(viewport?: ViewportSnapshot) {
  if (Project === undefined) return undefined;
  return {
    bridgeVersion: 1 as const,
    project: {
      id: Project.uuid ?? Project.name ?? "untitled-project",
      name: Project.name ?? "Untitled Blockbench Project",
      formatId: Project.format?.id ?? "unknown",
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
      })),
    ...(viewport === undefined ? {} : { viewport }),
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
