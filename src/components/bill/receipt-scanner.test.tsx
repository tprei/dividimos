import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PhotoOutcome } from "@/lib/capacitor/camera";

const mockGetPlatform = vi.fn(() => "web");

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => mockGetPlatform(),
  },
}));

const mockTakeNativePhoto = vi.fn();
const mockPickNativeGalleryPhoto = vi.fn();

vi.mock("@/lib/capacitor/camera", () => ({
  takeNativePhoto: () => mockTakeNativePhoto(),
  pickNativeGalleryPhoto: () => mockPickNativeGalleryPhoto(),
}));

import { ReceiptScanner } from "./receipt-scanner";

function createMockFile(name = "receipt.jpg", type = "image/jpeg"): File {
  return new File(["fake-image-data"], name, { type });
}

/** A MediaStream lookalike whose tracks record stop() calls. */
function createFakeStream(trackCount = 1): {
  stream: MediaStream;
  stops: Mock<() => void>[];
} {
  const stops: Mock<() => void>[] = [];
  const tracks = Array.from({ length: trackCount }, () => {
    const stop = vi.fn<() => void>();
    stops.push(stop);
    return { stop };
  });
  // happy-dom's srcObject setter requires a real MediaStream instance, so
  // the fake builds on it and shadows only the track accessors.
  const stream = new MediaStream();
  Object.defineProperty(stream, "getTracks", { value: () => tracks });
  Object.defineProperty(stream, "getVideoTracks", { value: () => tracks });
  Object.defineProperty(stream, "getAudioTracks", { value: () => [] });
  return { stream, stops };
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function stubMediaDevices(getUserMedia: GetUserMedia): void {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function stubCanvasCapture(blob: Blob): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback: BlobCallback) => {
      callback(blob);
    },
  );
}

function setVideoDimensions(
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: height,
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {});
}

// Stub object-URL helpers without replacing the URL constructor used by QR parsing.
const fakeUrl = "blob:http://localhost/fake-preview";
const originalUrlConstructor = globalThis.URL;
const originalMediaDevices = Object.getOwnPropertyDescriptor(
  window.navigator,
  "mediaDevices",
);
const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

beforeEach(() => {
  mockGetPlatform.mockReturnValue("web");
  mockTakeNativePhoto.mockReset();
  mockPickNativeGalleryPhoto.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(originalUrlConstructor, {
      createObjectURL: vi.fn(() => fakeUrl),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(window.navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(window.navigator, "mediaDevices");
  }
  if (originalVisibilityState) {
    Object.defineProperty(document, "visibilityState", originalVisibilityState);
  } else {
    Reflect.deleteProperty(document, "visibilityState");
  }
});

describe("ReceiptScanner", () => {
  describe("after selecting a file", () => {
    async function selectFile() {
      const onProcess = vi.fn();
      const user = userEvent.setup();
      stubMediaDevices(
        vi.fn<GetUserMedia>(() =>
          Promise.resolve(createFakeStream().stream),
        ),
      );
      const { container } = render(
        <ReceiptScanner onProcess={onProcess} onBack={vi.fn()} />,
      );

      const galleryInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      const mockFile = createMockFile();
      await user.upload(galleryInput, mockFile);

      return { onProcess, mockFile, container };
    }

    it("shows image preview after file selection", async () => {
      await selectFile();

      const img = screen.getByAltText("Foto da nota fiscal");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", fakeUrl);
    });

    it("calls onProcess with the file when Processar is clicked", async () => {
      const { onProcess, mockFile } = await selectFile();
      const user = userEvent.setup();

      const processBtn = screen.getByText("Processar").closest("button")!;
      await user.click(processBtn);
      expect(onProcess).toHaveBeenCalledWith(mockFile);
    });

    it("reopens the camera when retaking after a gallery pick", async () => {
      const { stream } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream));
      stubMediaDevices(getUserMedia);
      const { container } = render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      const galleryInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await userEvent.upload(galleryInput, createMockFile());
      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Trocar foto"));
      await flushMicrotasks();

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
    });

    it("offers gallery and back when the picked photo is removed", async () => {
      const onBack = vi.fn();
      const user = userEvent.setup();
      stubMediaDevices(
        vi.fn<GetUserMedia>(() =>
          Promise.resolve(createFakeStream().stream),
        ),
      );
      const { container } = render(
        <ReceiptScanner onProcess={vi.fn()} onBack={onBack} />,
      );

      const galleryInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(galleryInput, createMockFile());

      await user.click(screen.getByLabelText("Remover foto"));
      await flushMicrotasks();

      expect(screen.queryByAltText("Foto da nota fiscal")).toBeNull();
      expect(screen.getByText("Escolher da galeria")).toBeInTheDocument();

      await user.click(screen.getByText("Voltar"));
      expect(onBack).toHaveBeenCalledOnce();
    });

    it("revokes old object URL when clearing preview", async () => {
      await selectFile();
      const user = userEvent.setup();

      const changeBtn = screen.getByText("Trocar foto").closest("button")!;
      await user.click(changeBtn);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(fakeUrl);
    });

  });

  describe("processing state", () => {
    it("shows progress and disables the actions while processing", async () => {
      stubMediaDevices(
        vi.fn<GetUserMedia>(() =>
          Promise.resolve(createFakeStream().stream),
        ),
      );
      const { container } = render(
        <ReceiptScanner
          onProcess={vi.fn()}
          onBack={vi.fn()}
          processing={true}
        />,
      );

      const galleryInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      const user = userEvent.setup();
      await user.upload(galleryInput, createMockFile());

      const processBtn = screen.getByText("Processando...").closest("button")!;
      const changeBtn = screen.getByText("Trocar foto").closest("button")!;

      expect(processBtn).toBeDisabled();
      expect(changeBtn).toBeDisabled();
    });
  });

  describe("camera-first entry (web)", () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue("web");
    });

    it("never clicks a hidden file input when opened with the camera", async () => {
      const clickInput = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(() => {});
      const { stream } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream));
      stubMediaDevices(getUserMedia);

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(clickInput).not.toHaveBeenCalled();
      expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
      expect(screen.queryByText("Camera")).not.toBeInTheDocument();
    });

    it("attaches the stream to the video element", async () => {
      const { stream } = createFakeStream();
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      const video = screen.getByTestId(
        "receipt-camera-video",
      ) as HTMLVideoElement;
      expect(video.srcObject).toBe(stream);
      expect(screen.getByText("Iniciando câmera...")).toBeInTheDocument();
    });

    it("enables the shutter on metadata and feeds the capture into Processar", async () => {
      const onProcess = vi.fn();
      const { stream, stops } = createFakeStream();
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));
      stubCanvasCapture(new Blob(["fake-jpeg"], { type: "image/jpeg" }));
      const toBlob = vi
        .spyOn(HTMLCanvasElement.prototype, "toBlob")
        .mockImplementation((callback: BlobCallback) => {
          callback(new Blob(["fake-jpeg"], { type: "image/jpeg" }));
        });

      render(
        <ReceiptScanner onProcess={onProcess} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      const video = screen.getByTestId(
        "receipt-camera-video",
      ) as HTMLVideoElement;
      expect(screen.getByLabelText("Capturar foto")).toBeDisabled();

      setVideoDimensions(video, 640, 480);
      fireEvent(video, new Event("loadedmetadata"));

      const shutter = screen.getByLabelText("Capturar foto");
      expect(shutter).toBeEnabled();
      await userEvent.click(shutter);

      expect(toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        "image/jpeg",
        0.92,
      );
      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Processar"));
      expect(onProcess).toHaveBeenCalledOnce();
      const processedFile = onProcess.mock.calls[0]?.[0] as File | undefined;
      expect(processedFile?.type).toBe("image/jpeg");
      expect(processedFile?.name).toBe("nota-fiscal.jpg");
    });

    it("stops all tracks when a permission grant resolves after unmount", async () => {
      const { stream, stops } = createFakeStream(2);
      const deferred = Promise.withResolvers<MediaStream>();
      stubMediaDevices(vi.fn<GetUserMedia>(() => deferred.promise));

      const { unmount } = render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      unmount();

      await act(async () => {
        deferred.resolve(stream);
      });

      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
    });

    it("stops all tracks and leaves the scanner when the camera is closed", async () => {
      const { stream, stops } = createFakeStream(2);
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));
      const onBack = vi.fn();

      render(<ReceiptScanner onProcess={vi.fn()} onBack={onBack} />);
      await flushMicrotasks();

      await userEvent.click(screen.getByText("Fechar"));
      await flushMicrotasks();

      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
      expect(onBack).toHaveBeenCalledOnce();
    });

    it("hands off to the gallery picker inside the same user gesture", async () => {
      const { stream, stops } = createFakeStream();
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));
      const clickInput = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(() => {});
      const { container } = render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      await userEvent.click(screen.getByText("Galeria"));

      expect(clickInput).toHaveBeenCalledOnce();
      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
      expect(screen.queryByTestId("receipt-camera-video")).toBeNull();

      const galleryInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await userEvent.upload(galleryInput, createMockFile());
      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();
    });

    it("stops all tracks when the document is hidden and never restarts alone", async () => {
      const { stream, stops } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream));
      stubMediaDevices(getUserMedia);

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
      expect(screen.getByRole("alert")).toHaveTextContent("pausada");

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await flushMicrotasks();

      expect(getUserMedia).toHaveBeenCalledOnce();
    });

    it("offers retry, gallery and back when permission is denied", async () => {
      const denied = new Error("permission denied");
      denied.name = "NotAllowedError";
      const { stream } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.reject(denied));
      getUserMedia.mockRejectedValueOnce(denied);
      getUserMedia.mockResolvedValueOnce(stream);
      stubMediaDevices(getUserMedia);

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Permita o acesso à câmera");
      expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
      expect(screen.getByText("Galeria")).toBeInTheDocument();
      expect(screen.getByText("Voltar")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Tentar novamente"));
      await flushMicrotasks();

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Iniciando câmera...")).toBeInTheDocument();
    });

    it("leaves the scanner from the camera error card", async () => {
      const unavailable = new Error("getUserMedia indisponível");
      unavailable.name = "CameraUnavailableError";
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.reject(unavailable)));
      const onBack = vi.fn();

      render(<ReceiptScanner onProcess={vi.fn()} onBack={onBack} />);
      await flushMicrotasks();

      expect(screen.getByRole("alert")).toHaveTextContent("https");

      await userEvent.click(screen.getByText("Voltar"));

      expect(onBack).toHaveBeenCalledOnce();
    });

    it("retakes with the camera after a camera capture", async () => {
      const { stream } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream));
      stubMediaDevices(getUserMedia);
      stubCanvasCapture(new Blob(["fake-jpeg"], { type: "image/jpeg" }));

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      const video = screen.getByTestId(
        "receipt-camera-video",
      ) as HTMLVideoElement;
      setVideoDimensions(video, 640, 480);
      fireEvent(video, new Event("loadedmetadata"));
      await userEvent.click(screen.getByLabelText("Capturar foto"));
      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Trocar foto"));
      await flushMicrotasks();

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
      expect(screen.getByLabelText("Capturar foto")).toBeDisabled();
    });
  });

  describe("camera-first entry (Android)", () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue("android");
    });

    it("launches the native camera immediately and leaves the scanner when cancelled", async () => {
      const onBack = vi.fn();
      mockTakeNativePhoto.mockResolvedValue({ kind: "cancelled" });

      render(<ReceiptScanner onProcess={vi.fn()} onBack={onBack} />);
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledOnce();
      expect(onBack).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("attaches to the same in-flight intent across a StrictMode replay", async () => {
      const captured = createMockFile();
      const deferred = Promise.withResolvers<PhotoOutcome>();
      mockTakeNativePhoto.mockReturnValue(deferred.promise);

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
        { wrapper: StrictMode },
      );
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledOnce();

      await act(async () => {
        deferred.resolve({ kind: "captured", file: captured });
      });

      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();
    });

    it("relaunches a fresh native intent when retaking", async () => {
      const first = createMockFile("primeira.jpg");
      mockTakeNativePhoto
        .mockResolvedValueOnce({ kind: "captured", file: first })
        .mockResolvedValueOnce({ kind: "cancelled" });

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
      );
      await flushMicrotasks();

      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Trocar foto"));
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledTimes(2);
      expect(screen.queryByAltText("Foto da nota fiscal")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
