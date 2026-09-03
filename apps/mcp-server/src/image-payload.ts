import type { ImageMimeType } from "@blockbench-codex/contracts";

export const maxImageBytes = 8 * 1024 * 1024;

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const pngColorTypeOffset = 25;
const pngColorTypesWithAlpha = new Set([4, 6]);

/** Validates the payload against its declared format and returns its bytes. */
export function decodeImagePayload(
  dataBase64: string,
  mimeType: ImageMimeType,
  label = "image",
): Buffer {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.byteLength === 0) throw new Error(`The ${label} payload is empty.`);
  if (bytes.byteLength > maxImageBytes)
    throw new Error(`The ${label} exceeds the ${maxImageBytes} byte limit.`);
  const signature = mimeType === "image/png" ? pngSignature : jpegSignature;
  if (!bytes.subarray(0, signature.byteLength).equals(signature))
    throw new Error(`The ${label} payload is not valid ${mimeType}.`);
  return bytes;
}

/**
 * Reports whether the image can carry transparency at all. JPEG never can, and
 * a PNG needs an alpha color type or a tRNS chunk. Whether pixels are actually
 * transparent, rather than a painted checkerboard, is verified at import.
 */
export function hasAlphaChannel(
  bytes: Buffer,
  mimeType: ImageMimeType,
): boolean {
  if (mimeType !== "image/png") return false;
  const colorType = bytes.at(pngColorTypeOffset);
  if (colorType !== undefined && pngColorTypesWithAlpha.has(colorType))
    return true;
  return bytes.includes("tRNS", 0, "latin1");
}
