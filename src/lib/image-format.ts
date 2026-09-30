/**
 * Content-based image format detection for the receipt OCR route.
 *
 * The client-declared MIME type is untrusted: Gemini bills per byte and
 * accepts application/pdf and video/*, so a caller-chosen type must never
 * reach the provider. The route sends only the type detected from magic
 * bytes.
 */
export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp";

/** JPEG: FF D8 FF (SOI marker plus first marker byte). */
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

/** PNG: 89 50 4E 47 0D 0A 1A 0A (eight-byte signature). */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** WEBP: "RIFF" header plus "WEBP" form type at offset 8. */
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FORM = [0x57, 0x45, 0x42, 0x50] as const;

export function detectImageMimeType(bytes: Uint8Array): DetectedImageType | null {
  if (JPEG_MAGIC.every((byte, i) => bytes[i] === byte)) return "image/jpeg";
  if (PNG_MAGIC.every((byte, i) => bytes[i] === byte)) return "image/png";
  if (
    WEBP_RIFF.every((byte, i) => bytes[i] === byte) &&
    WEBP_FORM.every((byte, i) => bytes[8 + i] === byte)
  ) {
    return "image/webp";
  }
  return null;
}
