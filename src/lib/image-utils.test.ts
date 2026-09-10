import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compressImage, ImagePolicyError } from "./image-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = "receipt.jpg", size = 1024) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: "image/jpeg" });
}

function makeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function makeCtx() {
  return { drawImage: vi.fn() } as unknown as OffscreenCanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockBitmap: ReturnType<typeof makeBitmap>;
let mockCtx: ReturnType<typeof makeCtx>;
let convertToBlobMock: ReturnType<typeof vi.fn>;
let savedOffscreenCanvas: typeof globalThis.OffscreenCanvas | undefined;

beforeEach(() => {
  mockBitmap = makeBitmap(3000, 4000);
  mockCtx = makeCtx();

  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue(mockBitmap),
  );

  convertToBlobMock = vi.fn().mockResolvedValue(
    new Blob(["compressed"], { type: "image/jpeg" }),
  );
  savedOffscreenCanvas = globalThis.OffscreenCanvas;

  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return mockCtx;
    }
    convertToBlob = convertToBlobMock;
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedOffscreenCanvas) {
    globalThis.OffscreenCanvas = savedOffscreenCanvas;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compressImage", () => {
  it("returns a File with the same name", async () => {
    const result = await compressImage(makeFile("nota.jpg"));
    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe("nota.jpg");
  });

  it("scales a tall image to fit maxSize (default 1024)", async () => {
    // 3000×4000 → scale = 1024/4000 = 0.256 → drawImage(bitmap, 0, 0, 768, 1024)
    await compressImage(makeFile());

    const [, , , w, h] = (mockCtx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(w).toBe(Math.round(3000 * (1024 / 4000)));
    expect(h).toBe(1024);
  });

  it("scales a wide image to fit maxSize", async () => {
    mockBitmap = makeBitmap(5000, 2000);
    vi.mocked(createImageBitmap).mockResolvedValue(mockBitmap);

    await compressImage(makeFile());

    const [, , , w, h] = (mockCtx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(w).toBe(1024);
    expect(h).toBe(Math.round(2000 * (1024 / 5000)));
  });

  it("does not upscale a small image", async () => {
    mockBitmap = makeBitmap(500, 300);
    vi.mocked(createImageBitmap).mockResolvedValue(mockBitmap);

    await compressImage(makeFile());

    const [, , , w, h] = (mockCtx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(w).toBe(500);
    expect(h).toBe(300);
  });

  it("respects custom maxSize and quality", async () => {
    await compressImage(makeFile(), { maxSize: 512, quality: 0.5 });

    const [, , , w, h] = (mockCtx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(w).toBe(Math.round(3000 * (512 / 4000)));
    expect(h).toBe(512);
    expect(convertToBlobMock).toHaveBeenCalledWith({
      type: "image/jpeg",
      quality: 0.5,
    });
  });

  it("closes the ImageBitmap after compression", async () => {
    await compressImage(makeFile());
    expect(mockBitmap.close).toHaveBeenCalledOnce();
  });

  it("draws the image onto the canvas context", async () => {
    await compressImage(makeFile());
    expect(mockCtx.drawImage).toHaveBeenCalledOnce();
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      mockBitmap,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("falls back to HTMLCanvasElement when OffscreenCanvas is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "OffscreenCanvas");

    const fallbackCtx = makeCtx();
    const toBlobMock = vi.fn((cb: BlobCallback) => {
      cb(new Blob(["fallback"], { type: "image/jpeg" }));
    });

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fallbackCtx),
      toBlob: toBlobMock,
    };

    vi.spyOn(document, "createElement").mockReturnValue(
      fakeCanvas as unknown as HTMLElement,
    );

    const result = await compressImage(makeFile("foto.jpg"));
    expect(result.name).toBe("foto.jpg");
    expect(toBlobMock).toHaveBeenCalledOnce();
    expect(fallbackCtx.drawImage).toHaveBeenCalledOnce();
  });
});

describe("decode policy", () => {
  it("refuses an oversized file before decoding it", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    await expect(compressImage(makeFile("huge.jpg", 13 * 1024 * 1024))).rejects.toThrow(
      ImagePolicyError,
    );
    // The whole point: no raster is ever allocated.
    expect(decode).not.toHaveBeenCalled();
  });

  it("refuses an over-resolution image and still releases the bitmap", async () => {
    const bitmap = makeBitmap(9000, 9000);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    await expect(compressImage(makeFile())).rejects.toThrow(ImagePolicyError);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes the bitmap exactly once when encoding fails after the decode", async () => {
    convertToBlobMock.mockRejectedValue(new Error("encoder died"));

    await expect(compressImage(makeFile())).rejects.toThrow();
    expect(mockBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("reports an undecodable image as retryable", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("not an image")),
    );

    const error = await compressImage(makeFile()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImagePolicyError);
    expect((error as ImagePolicyError).retryable).toBe(true);
  });
});
