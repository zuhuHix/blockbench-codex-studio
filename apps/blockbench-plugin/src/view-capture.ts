import type {
  CaptureViewsCommand,
  MultiViewCapture,
  ViewAngle,
  ViewCapture,
} from "@blockbench-codex/contracts";

/**
 * Unit camera directions per angle, in Blockbench preview space. The six axis
 * views match Blockbench's own default camera presets; `isometric` is the
 * three-quarter angle used for review renders.
 */
const angleDirections: Record<ViewAngle, readonly [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  isometric: [0.577, 0.577, 0.577],
};

/** Axis views read best orthographically, as they do in Blockbench itself. */
const orthographicAngles = new Set<ViewAngle>([
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
]);

/** Camera distance that keeps the whole model in frame for every angle. */
export function cameraDistance(
  extents: readonly (readonly number[])[],
  fallback = 64,
): number {
  let largest = 0;
  for (const extent of extents)
    for (const value of extent) largest = Math.max(largest, Math.abs(value));
  return largest === 0 ? fallback : Math.max(fallback, largest * 2.4);
}

function sceneExtents(): readonly (readonly number[])[] {
  return Cube.all.flatMap((cube) =>
    cube.from === undefined || cube.to === undefined
      ? []
      : [
          [...cube.from].map((value) => value - 8),
          [...cube.to].map((value) => value - 8),
        ],
  );
}

function screenshot(
  preview: NonNullable<typeof Preview.selected>,
  size: number,
): Promise<{ mimeType: "image/png" | "image/jpeg"; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    preview.screenshot({ width: size, height: size }, (dataUrl) => {
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/s.exec(dataUrl);
      if (match === null) {
        reject(new Error("Blockbench returned an unreadable screenshot."));
        return;
      }
      resolve({
        mimeType: match[1] as "image/png" | "image/jpeg",
        dataBase64: match[2]!,
      });
    });
  });
}

function pointCamera(
  preview: NonNullable<typeof Preview.selected>,
  angle: ViewAngle,
  distance: number,
): void {
  const [x, y, z] = angleDirections[angle];
  const position: [number, number, number] = [
    x * distance,
    y * distance,
    z * distance,
  ];
  if (preview.loadAnglePreset !== undefined) {
    preview.loadAnglePreset({
      projection: orthographicAngles.has(angle) ? "orthographic" : "unset",
      position,
      target: [0, 0, 0],
    });
    return;
  }
  preview.setProjectionMode?.(orthographicAngles.has(angle), true);
  preview.camera?.position.set(...position);
  preview.controls?.target.set(0, 0, 0);
  preview.controls?.update?.();
  preview.camera?.updateProjectionMatrix?.();
  preview.render?.();
}

/**
 * Drives the active preview camera through each requested angle, capturing one
 * image per angle, then restores the camera exactly as the user left it. The
 * model itself is never touched, so this stays outside the Undo stack.
 */
export async function captureViews(
  command: CaptureViewsCommand,
): Promise<MultiViewCapture> {
  if ((Project?.uuid ?? Project?.name) !== command.projectId)
    throw new Error("Command targets a different Blockbench project.");
  const preview = Preview.selected;
  if (preview === undefined)
    throw new Error("Blockbench has no active preview to capture.");

  const camera = preview.camera;
  const controls = preview.controls;
  const previousPosition =
    camera === undefined
      ? undefined
      : ([camera.position.x, camera.position.y, camera.position.z] as const);
  const previousTarget =
    controls === undefined
      ? undefined
      : ([controls.target.x, controls.target.y, controls.target.z] as const);
  const previousOrtho = preview.isOrtho ?? false;
  const distance = cameraDistance(sceneExtents());

  const views: ViewCapture[] = [];
  try {
    for (const angle of command.angles) {
      pointCamera(preview, angle, distance);
      const image = await screenshot(preview, command.size);
      views.push({
        angle,
        mimeType: image.mimeType,
        dataBase64: image.dataBase64,
        width: command.size,
        height: command.size,
        capturedAt: new Date().toISOString(),
      });
    }
  } finally {
    preview.setProjectionMode?.(previousOrtho, true);
    if (previousPosition !== undefined)
      camera?.position.set(...previousPosition);
    if (previousTarget !== undefined) controls?.target.set(...previousTarget);
    controls?.update?.();
    camera?.updateProjectionMatrix?.();
    preview.render?.();
  }

  return {
    requestId: command.requestId,
    projectId: command.projectId,
    views,
    capturedAt: new Date().toISOString(),
  };
}
