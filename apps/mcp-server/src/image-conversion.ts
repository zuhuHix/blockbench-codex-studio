import sharp from "sharp";

import {
  imageAlphaInspectionSchema,
  type ImageAlphaInspection,
  type PixelArtConversion,
} from "@blockbench-codex/contracts";

function color(value: string): readonly [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function nearest(
  red: number,
  green: number,
  blue: number,
  palette: readonly (readonly [number, number, number])[],
): readonly [number, number, number] {
  let best = palette[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const distance =
      (red - candidate[0]) ** 2 +
      (green - candidate[1]) ** 2 +
      (blue - candidate[2]) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Decodes real pixel alpha; an opaque painted checkerboard remains opaque. */
export async function inspectImageAlpha(
  bytes: Buffer,
): Promise<ImageAlphaInspection> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparentPixelCount = 0;
  let translucentPixelCount = 0;
  let opaquePixelCount = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset]!;
    if (alpha === 0) transparentPixelCount += 1;
    else if (alpha < 255) translucentPixelCount += 1;
    else opaquePixelCount += 1;
  }
  return imageAlphaInspectionSchema.parse({
    width: info.width,
    height: info.height,
    hasRealTransparency: transparentPixelCount + translucentPixelCount > 0,
    transparentPixelCount,
    translucentPixelCount,
    opaquePixelCount,
  });
}

/** Nearest-neighbor resize with either an exact or bounded generated palette. */
export async function convertToPixelArt(
  bytes: Buffer,
  options: PixelArtConversion,
): Promise<Buffer> {
  const pipeline = sharp(bytes).resize(options.width, options.height, {
    kernel: sharp.kernel.nearest,
    fit: "fill",
  });
  if (options.manualPalette === undefined)
    return pipeline
      .png({ palette: true, colours: options.paletteColors, dither: 0 })
      .toBuffer();

  const palette = options.manualPalette.map(color);
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const mapped = nearest(
      data[offset]!,
      data[offset + 1]!,
      data[offset + 2]!,
      palette,
    );
    data[offset] = mapped[0];
    data[offset + 1] = mapped[1];
    data[offset + 2] = mapped[2];
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({
      palette: true,
      colours: Math.min(256, palette.length + 1),
      dither: 0,
    })
    .toBuffer();
}
