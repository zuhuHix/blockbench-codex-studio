import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { convertToPixelArt, inspectImageAlpha } from "./image-conversion.js";

async function source(alpha: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 4,
      height: 3,
      channels: 4,
      background: { r: 120, g: 80, b: 40, alpha },
    },
  })
    .png()
    .toBuffer();
}

describe("pixel-art conversion", () => {
  it("uses nearest-neighbor output dimensions and a bounded palette", async () => {
    const converted = await convertToPixelArt(await source(1), {
      width: 16,
      height: 16,
      paletteColors: 8,
    });
    const metadata = await sharp(converted).metadata();
    expect(metadata).toMatchObject({ width: 16, height: 16, format: "png" });
    expect(metadata.isPalette).toBe(true);
  });

  it("maps RGB to an exact manual palette without discarding alpha", async () => {
    const converted = await convertToPixelArt(await source(0.5), {
      width: 2,
      height: 2,
      paletteColors: 32,
      manualPalette: ["#000000", "#ffffff"],
    });
    const inspection = await inspectImageAlpha(converted);
    expect(inspection).toMatchObject({
      width: 2,
      height: 2,
      hasRealTransparency: true,
      translucentPixelCount: 4,
    });
  });

  it("does not mistake opaque pixels for real transparency", async () => {
    expect(await inspectImageAlpha(await source(1))).toMatchObject({
      hasRealTransparency: false,
      opaquePixelCount: 12,
    });
  });
});
