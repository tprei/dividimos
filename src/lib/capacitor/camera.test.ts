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
      Promise.resolve({ blob: () => Promise.resolve(fakeBlob) }),
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
    const file = await takeNativePhoto();

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
    const file = await takeNativePhoto();

    expect(file.name).toBe("photo.png");
    expect(file.type).toBe("image/png");
  });

  it("defaults to jpeg when format is missing", async () => {
    mockGetPhoto.mockResolvedValue({
      webPath: "capacitor://localhost/photo",
    });

    const { takeNativePhoto } = await import("./camera");
    const file = await takeNativePhoto();

    expect(file.name).toBe("photo.jpeg");
    expect(file.type).toBe("image/jpeg");
  });
});

describe("pickNativeGalleryPhoto", () => {
  it("returns a File from the gallery", async () => {
    const { pickNativeGalleryPhoto } = await import("./camera");
    const file = await pickNativeGalleryPhoto();

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
