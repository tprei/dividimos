import { describe, it, expect } from "vitest";
import { detectImageMimeType } from "@/lib/image-format";

// Minimal real-format fixtures: signature bytes plus the header fields that
// follow them in actual files.
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
]);

const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

const PDF_BYTES = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3,
]);

const GIF_BYTES = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
]);

describe("detectImageMimeType", () => {
  it("detects JPEG from the SOI marker", () => {
    expect(detectImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
  });

  it("detects PNG from the eight-byte signature", () => {
    expect(detectImageMimeType(PNG_BYTES)).toBe("image/png");
  });

  it("detects WEBP from the RIFF header and WEBP form type", () => {
    expect(detectImageMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("rejects a PDF", () => {
    expect(detectImageMimeType(PDF_BYTES)).toBeNull();
  });

  it("rejects a GIF", () => {
    expect(detectImageMimeType(GIF_BYTES)).toBeNull();
  });

  it("rejects arbitrary garbage", () => {
    expect(detectImageMimeType(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it("rejects empty bytes", () => {
    expect(detectImageMimeType(new Uint8Array(0))).toBeNull();
  });

  it("rejects truncated signatures", () => {
    expect(detectImageMimeType(JPEG_BYTES.slice(0, 2))).toBeNull();
    expect(detectImageMimeType(PNG_BYTES.slice(0, 7))).toBeNull();
    // RIFF container without the WEBP form type at offset 8.
    expect(detectImageMimeType(WEBP_BYTES.slice(0, 11))).toBeNull();
  });

  it("rejects RIFF containers that are not WEBP (WAV audio)", () => {
    const wav = Uint8Array.from(WEBP_BYTES);
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(detectImageMimeType(wav)).toBeNull();
  });

  it("rejects a single flipped signature byte", () => {
    const corrupted = Uint8Array.from(PNG_BYTES);
    corrupted[3] = 0x4f;
    expect(detectImageMimeType(corrupted)).toBeNull();
  });
});
