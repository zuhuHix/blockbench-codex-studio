import sharp from "sharp";

/** A rectangle in texture pixels, ordered [left, top, right, bottom]. */
export type PixelRect = readonly [number, number, number, number];

/** A colour as `#rgb`, `#rrggbb`, `#rrggbbaa`, or `transparent`. */
export type PaintColor = string;

export interface PaintStroke {
  /** Texture-pixel rectangle, `[left, top, right, bottom]`. */
  readonly rect: PixelRect;
  /** Flat colour for the whole rectangle. */
  readonly fill?: PaintColor;
  /**
   * Explicit pixels, top row first. `null` keeps the pixel already there, so a
   * grid can add detail without erasing the art around it.
   */
  readonly pixels?: readonly (readonly (PaintColor | null)[])[];
}

export interface RasterImage {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

type Rgba = readonly [number, number, number, number];

export function parseColor(value: PaintColor): Rgba {
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(value)?.[1];
  if (hex === undefined || ![3, 4, 6, 8].includes(hex.length))
    throw new Error(
      `Colour ${value} must be #rgb, #rgba, #rrggbb, #rrggbbaa, or transparent.`,
    );
  const wide = hex.length > 4;
  const part = (index: number) => {
    const slice = wide
      ? hex.slice(index * 2, index * 2 + 2)
      : hex[index]!.repeat(2);
    return Number.parseInt(slice, 16);
  };
  const alphaIndex = wide ? hex.length === 8 : hex.length === 4;
  return [part(0), part(1), part(2), alphaIndex ? part(3) : 255];
}

export function formatColor(rgba: Rgba): string {
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}${hex(rgba[3])}`;
}

/** Rounds a UV rectangle outward to whole texture pixels and clamps it. */
export function pixelRect(
  rect: PixelRect,
  width: number,
  height: number,
): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  const left = Math.max(0, Math.floor(Math.min(rect[0], rect[2])));
  const top = Math.max(0, Math.floor(Math.min(rect[1], rect[3])));
  const right = Math.min(width, Math.ceil(Math.max(rect[0], rect[2])));
  const bottom = Math.min(height, Math.ceil(Math.max(rect[1], rect[3])));
  if (right <= left || bottom <= top)
    throw new Error("The region does not overlap the texture.");
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export async function decodeTexture(png: Buffer): Promise<RasterImage> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function encodeTexture(image: RasterImage): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Applies every stroke to a copy of `image`. Strokes are painted in order and
 * `null` pixels are left alone, so callers can layer a base fill and details in
 * a single, one-undo-step repaint.
 */
export function paintStrokes(
  image: RasterImage,
  strokes: readonly PaintStroke[],
): { readonly image: RasterImage; readonly changedPixels: number } {
  const data = Buffer.from(image.data);
  let changedPixels = 0;
  for (const stroke of strokes) {
    if (stroke.fill === undefined && stroke.pixels === undefined)
      throw new Error("A stroke needs either a fill colour or a pixel grid.");
    const area = pixelRect(stroke.rect, image.width, image.height);
    if (stroke.pixels !== undefined) {
      if (stroke.pixels.length !== area.h)
        throw new Error(
          `Pixel grid has ${stroke.pixels.length} rows but the region is ${area.h} pixels tall.`,
        );
      for (const row of stroke.pixels)
        if (row.length !== area.w)
          throw new Error(
            `Pixel grid has a ${row.length}-pixel row but the region is ${area.w} pixels wide.`,
          );
    }
    const fill =
      stroke.fill === undefined ? undefined : parseColor(stroke.fill);
    for (let row = 0; row < area.h; row += 1)
      for (let column = 0; column < area.w; column += 1) {
        const cell = stroke.pixels?.[row]?.[column];
        const color =
          cell === null
            ? undefined
            : cell === undefined
              ? fill
              : parseColor(cell);
        if (color === undefined) continue;
        const offset = ((area.y + row) * image.width + area.x + column) * 4;
        if (
          data[offset] !== color[0] ||
          data[offset + 1] !== color[1] ||
          data[offset + 2] !== color[2] ||
          data[offset + 3] !== color[3]
        )
          changedPixels += 1;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = color[3];
      }
  }
  return {
    image: { data, width: image.width, height: image.height },
    changedPixels,
  };
}

/** The exact pixels of a region, as a grid the model can read and edit. */
export function readRegion(
  image: RasterImage,
  rect: PixelRect,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly (readonly string[])[];
} {
  const area = pixelRect(rect, image.width, image.height);
  const rows: string[][] = [];
  for (let row = 0; row < area.h; row += 1) {
    const line: string[] = [];
    for (let column = 0; column < area.w; column += 1) {
      const offset = ((area.y + row) * image.width + area.x + column) * 4;
      line.push(
        formatColor([
          image.data[offset]!,
          image.data[offset + 1]!,
          image.data[offset + 2]!,
          image.data[offset + 3]!,
        ]),
      );
    }
    rows.push(line);
  }
  return { x: area.x, y: area.y, width: area.w, height: area.h, rows };
}

/**
 * A nearest-neighbour blow-up of a region, so the model can actually look at
 * pixel art instead of only reading hex values.
 */
export async function previewRegion(
  image: RasterImage,
  rect: PixelRect,
  maximumSize = 512,
): Promise<{ readonly dataBase64: string; readonly scale: number }> {
  const area = pixelRect(rect, image.width, image.height);
  const scale = Math.max(
    1,
    Math.floor(maximumSize / Math.max(area.w, area.h)) || 1,
  );
  const buffer = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .extract({ left: area.x, top: area.y, width: area.w, height: area.h })
    .resize({
      width: area.w * scale,
      height: area.h * scale,
      kernel: "nearest",
    })
    .png()
    .toBuffer();
  return { dataBase64: buffer.toString("base64"), scale };
}
