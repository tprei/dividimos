/**
 * Canvas-based image compression for receipt photos.
 *
 * Resizes to a max dimension and re-encodes as JPEG to reduce payload size
 * before sending to the OCR API. Pure browser APIs — no external dependencies.
 */

const DEFAULT_MAX_SIZE = 1024;
const DEFAULT_QUALITY = 0.75;
const JPEG_TYPE = "image/jpeg";

/**
 * Largest encoded file we will decode. Any phone-camera receipt photo fits
 * well inside this; larger input is refused before a raster is allocated,
 * because decoding is what exhausts memory, not holding the file.
 */
const MAX_ENCODED_BYTES = 12 * 1024 * 1024;

/**
 * Largest pixel count we will decode: 40 megapixels, several times any phone
 * sensor. A decode that size costs ~160 MB of RGBA before any scaling.
 */
const MAX_DECODED_PIXELS = 40_000_000;

/** An image this code refuses to decode, or could not decode. */
export class ImagePolicyError extends Error {
  readonly retryable = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ImagePolicyError";
  }
}

export interface CompressImageOptions {
  /** Maximum width or height in pixels (default: 1024) */
  maxSize?: number;
  /** JPEG quality 0–1 (default: 0.75) */
  quality?: number;
  /** Output MIME type (default: "image/jpeg") */
  type?: string;
}

/**
 * Compress and resize an image file using OffscreenCanvas (or <canvas> fallback).
 *
 * Returns a new File with the same name but compressed content.
 * If the image is already smaller than maxSize in both dimensions,
 * it is still re-encoded at the target quality to normalize format.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const {
    maxSize = DEFAULT_MAX_SIZE,
    quality = DEFAULT_QUALITY,
    type = JPEG_TYPE,
  } = options;

  if (file.size > MAX_ENCODED_BYTES) {
    throw new ImagePolicyError(
      "Essa imagem é muito grande. Tire outra foto ou escolha uma menor.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImagePolicyError(
      "Não conseguimos ler essa imagem. Tente outra foto.",
    );
  }

  // Every path past the decode releases the bitmap exactly once.
  try {
    const { width, height } = bitmap;

    if (width * height > MAX_DECODED_PIXELS) {
      throw new ImagePolicyError(
        "Essa imagem tem resolução muito alta. Tire outra foto.",
      );
    }

    // Calculate scaled dimensions preserving aspect ratio
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    let blob: Blob;

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImagePolicyError("Não conseguimos processar a imagem.");
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      blob = await canvas.convertToBlob({ type, quality });
    } else {
      // Fallback for environments without OffscreenCanvas (e.g. Safari < 16.4)
      blob = await canvasFallback(bitmap, targetWidth, targetHeight, type, quality);
    }

    return new File([blob], file.name, { type: blob.type });
  } finally {
    bitmap.close();
  }
}

/** HTMLCanvasElement fallback for browsers that lack OffscreenCanvas. */
function canvasFallback(
  source: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get canvas 2d context"));
      return;
    }
    ctx.drawImage(source, 0, 0, width, height);
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("canvas.toBlob returned null"));
      },
      type,
      quality,
    );
  });
}
