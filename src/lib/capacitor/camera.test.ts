import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPlatform = vi.fn(() => "android");
const mockGetPhoto = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => mockGetPlatform(),
  },
}));

vi.mock("@capacitor/camera", () => ({
  Camera: {
    getPhoto: (...args: unknown[]) => mockGetPhoto(...args),
  },
  CameraResultType: { Uri: "uri" },
  CameraSource: { Camera: "CAMERA", Photos: "PHOTOS" },
}));

const fakeBlob = new Blob(["fake-image"], { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlatform.mockReturnValue("android");
  mockGetPhoto.mockResolvedValue({
    webPath: "capacitor://localhost/photo.jpeg",
    format: "jpeg",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(fakeBlob) }),
    ),
  );
});

describe("isNativeCameraAvailable", () => {
  it("returns true on android", async () => {
    mockGetPlatform.mockReturnValue("android");
    const { isNativeCameraAvailable } = await import("./camera");
    expect(isNativeCameraAvailable()).toBe(true);
  });

  it("returns false on web", async () => {
    mockGetPlatform.mockReturnValue("web");
    const { isNativeCameraAvailable } = await import("./camera");
    expect(isNativeCameraAvailable()).toBe(false);
  });

  it("returns false on ios", async () => {
    mockGetPlatform.mockReturnValue("ios");
    const { isNativeCameraAvailable } = await import("./camera");
    expect(isNativeCameraAvailable()).toBe(false);
  });
});

describe("takeNativePhoto", () => {
  it("returns a File from the camera", async () => {
    const { takeNativePhoto } = await import("./camera");
    const outcome = await takeNativePhoto();
    if (outcome.kind !== "captured") throw new Error(`expected a photo, got ${outcome.kind}`);
    const file = outcome.file;

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("photo.jpeg");
    expect(file.type).toBe("image/jpeg");
    expect(mockGetPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ source: "CAMERA" }),
    );
  });

  it("uses format from photo result", async () => {
    mockGetPhoto.mockResolvedValue({
      webPath: "capacitor://localhost/photo.png",
      format: "png",
    });

    const { takeNativePhoto } = await import("./camera");
    const outcome = await takeNativePhoto();
    if (outcome.kind !== "captured") throw new Error(`expected a photo, got ${outcome.kind}`);
    const file = outcome.file;

    expect(file.name).toBe("photo.png");
    expect(file.type).toBe("image/png");
  });

  it("defaults to jpeg when format is missing", async () => {
    mockGetPhoto.mockResolvedValue({
      webPath: "capacitor://localhost/photo",
    });

    const { takeNativePhoto } = await import("./camera");
    const outcome = await takeNativePhoto();
    if (outcome.kind !== "captured") throw new Error(`expected a photo, got ${outcome.kind}`);
    const file = outcome.file;

    expect(file.name).toBe("photo.jpeg");
    expect(file.type).toBe("image/jpeg");
  });
});

describe("pickNativeGalleryPhoto", () => {
  it("returns a File from the gallery", async () => {
    const { pickNativeGalleryPhoto } = await import("./camera");
    const outcome = await pickNativeGalleryPhoto();
    if (outcome.kind !== "captured") throw new Error(`expected a photo, got ${outcome.kind}`);
    const file = outcome.file;

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("photo.jpeg");
    expect(mockGetPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ source: "PHOTOS" }),
    );
  });

  it("calls getPhoto with Photos source", async () => {
    const { pickNativeGalleryPhoto } = await import("./camera");
    await pickNativeGalleryPhoto();

    expect(mockGetPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ source: "PHOTOS" }),
    );
  });
});

describe("capture outcomes", () => {
  it("reports a user backing out as a cancellation", async () => {
    mockGetPhoto.mockRejectedValue(new Error("User cancelled photos app"));

    const { takeNativePhoto } = await import("./camera");
    expect((await takeNativePhoto()).kind).toBe("cancelled");
  });

  it("reports a refused permission as a denial, not a cancellation", async () => {
    mockGetPhoto.mockRejectedValue(new Error("User denied access to camera"));

    const { takeNativePhoto } = await import("./camera");
    // Swallowing this as a cancellation left the button looking broken.
    expect((await takeNativePhoto()).kind).toBe("permission_denied");
  });

  it("reports an unreadable photo instead of pretending it was cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, blob: () => Promise.resolve(fakeBlob) })));

    const { takeNativePhoto } = await import("./camera");
    expect((await takeNativePhoto()).kind).toBe("error");
  });

  it("reports a photo with no readable path as an error", async () => {
    mockGetPhoto.mockResolvedValue({ format: "jpeg" });

    const { takeNativePhoto } = await import("./camera");
    expect((await takeNativePhoto()).kind).toBe("error");
  });
});
