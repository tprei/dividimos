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
  it("renders heading and description", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Escanear nota")).toBeInTheDocument();
    expect(
      screen.getByText("Tire uma foto ou escolha da galeria."),
    ).toBeInTheDocument();
  });

  it("renders camera and gallery buttons initially", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("Galeria")).toBeInTheDocument();
    expect(screen.getByText("Tirar foto agora")).toBeInTheDocument();
    expect(screen.getByText("Escolher foto")).toBeInTheDocument();
  });

  it("opens the chooser by default without touching the camera", async () => {
    const clickInput = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const getUserMedia = vi.fn<GetUserMedia>(() => new Promise(() => {}));
    stubMediaDevices(getUserMedia);

    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);
    await flushMicrotasks();

    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.queryByTestId("receipt-camera-video")).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(clickInput).not.toHaveBeenCalled();
  });

  it("does not show preview or process button initially", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.queryByText("Processar")).not.toBeInTheDocument();
    expect(
      screen.queryByAltText("Foto da nota fiscal"),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ReceiptScanner onProcess={vi.fn()} onBack={onBack} />);

    const backBtn = screen.getByLabelText("Voltar");
    await user.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("has a single hidden gallery input and no capture-attribute input", () => {
    const { container } = render(
      <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
    );

    const fileInputs = container.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0]!).toHaveAttribute("accept", "image/*");
    expect(fileInputs[0]!).not.toHaveAttribute("capture");
  });

  describe("after selecting a file", () => {
    async function selectFile() {
      const onProcess = vi.fn();
      const user = userEvent.setup();
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

    it("shows Processar and Trocar foto buttons", async () => {
      await selectFile();

      expect(screen.getByText("Processar")).toBeInTheDocument();
      expect(screen.getByText("Trocar foto")).toBeInTheDocument();
    });

    it("hides camera/gallery buttons when preview is shown", async () => {
      await selectFile();

      expect(screen.queryByText("Camera")).not.toBeInTheDocument();
      expect(screen.queryByText("Galeria")).not.toBeInTheDocument();
    });

    it("calls onProcess with the file when Processar is clicked", async () => {
      const { onProcess, mockFile } = await selectFile();
      const user = userEvent.setup();

      const processBtn = screen.getByText("Processar").closest("button")!;
      await user.click(processBtn);
      expect(onProcess).toHaveBeenCalledWith(mockFile);
    });

    it("clears preview when Trocar foto is clicked", async () => {
      await selectFile();
      const user = userEvent.setup();

      const changeBtn = screen.getByText("Trocar foto").closest("button")!;
      await user.click(changeBtn);

      // Should go back to input mode
      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.getByText("Galeria")).toBeInTheDocument();
      expect(
        screen.queryByAltText("Foto da nota fiscal"),
      ).not.toBeInTheDocument();
    });

    it("clears preview when X button on image is clicked", async () => {
      await selectFile();
      const user = userEvent.setup();

      const removeBtn = screen.getByLabelText("Remover foto");
      await user.click(removeBtn);

      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(
        screen.queryByAltText("Foto da nota fiscal"),
      ).not.toBeInTheDocument();
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
    it("shows Processando... when processing is true", async () => {
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

      expect(screen.getByText("Processando...")).toBeInTheDocument();
    });

    it("disables buttons when processing", async () => {
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

  describe("Android native capture", () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue("android");
    });

    it("calls takeNativePhoto when Camera is clicked on Android", async () => {
      const mockFile = createMockFile();
      mockTakeNativePhoto.mockResolvedValue({ kind: "captured", file: mockFile });

      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      const cameraBtn = screen.getByText("Camera").closest("button")!;
      await user.click(cameraBtn);
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledOnce();
      expect(mockPickNativeGalleryPhoto).not.toHaveBeenCalled();
    });

    it("calls pickNativeGalleryPhoto when Galeria is clicked on Android", async () => {
      const mockFile = createMockFile();
      mockPickNativeGalleryPhoto.mockResolvedValue({
        kind: "captured",
        file: mockFile,
      });

      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      const galleryBtn = screen.getByText("Galeria").closest("button")!;
      await user.click(galleryBtn);

      expect(mockPickNativeGalleryPhoto).toHaveBeenCalledOnce();
      expect(mockTakeNativePhoto).not.toHaveBeenCalled();
    });

    it("shows preview after native capture", async () => {
      const mockFile = createMockFile();
      mockTakeNativePhoto.mockResolvedValue({ kind: "captured", file: mockFile });

      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      const cameraBtn = screen.getByText("Camera").closest("button")!;
      await user.click(cameraBtn);
      await flushMicrotasks();

      const img = screen.getByAltText("Foto da nota fiscal");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", fakeUrl);
    });
  });

  describe("Web file inputs (non-Android)", () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue("web");
    });

    it("opens the live camera instead of native capture when Camera is clicked", async () => {
      const { stream } = createFakeStream();
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));

      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      const cameraBtn = screen.getByText("Camera").closest("button")!;
      await user.click(cameraBtn);
      await flushMicrotasks();

      expect(mockTakeNativePhoto).not.toHaveBeenCalled();
      expect(mockPickNativeGalleryPhoto).not.toHaveBeenCalled();
      expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
    });
  });

  describe("capture failures", () => {
    beforeEach(() => {
      mockGetPlatform.mockReturnValue("android");
    });

    it("stays silent when the user backs out", async () => {
      mockTakeNativePhoto.mockResolvedValue({ kind: "cancelled" });
      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Camera").closest("button")!);
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("explains a refused camera permission instead of doing nothing", async () => {
      mockTakeNativePhoto.mockResolvedValue({ kind: "permission_denied" });
      render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Camera").closest("button")!);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/configura/i);
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={onProcess} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
      );
      unmount();

      await act(async () => {
        deferred.resolve(stream);
      });

      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
    });

    it("stops all tracks when the camera is closed", async () => {
      const { stream, stops } = createFakeStream(2);
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
      );
      await flushMicrotasks();

      await userEvent.click(screen.getByText("Fechar"));
      await flushMicrotasks();

      for (const stop of stops) {
        expect(stop).toHaveBeenCalledOnce();
      }
      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.queryByTestId("receipt-camera-video")).toBeNull();
    });

    it("hands off to the gallery picker inside the same user gesture", async () => {
      const { stream, stops } = createFakeStream();
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.resolve(stream)));
      const clickInput = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(() => {});
      const { container } = render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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

    it("returns to the chooser from the camera error card", async () => {
      const unavailable = new Error("getUserMedia indisponível");
      unavailable.name = "CameraUnavailableError";
      stubMediaDevices(vi.fn<GetUserMedia>(() => Promise.reject(unavailable)));

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
      );
      await flushMicrotasks();

      expect(screen.getByRole("alert")).toHaveTextContent("https");

      await userEvent.click(screen.getByText("Voltar"));

      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("retakes with the camera after a camera capture", async () => {
      const { stream } = createFakeStream();
      const getUserMedia = vi.fn<GetUserMedia>(() => Promise.resolve(stream));
      stubMediaDevices(getUserMedia);
      stubCanvasCapture(new Blob(["fake-jpeg"], { type: "image/jpeg" }));

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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

    it("launches the native camera immediately and lands on the picker when cancelled", async () => {
      const onBack = vi.fn();
      mockTakeNativePhoto.mockResolvedValue({ kind: "cancelled" });

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={onBack} initialSource="camera" />,
      );
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledOnce();
      expect(onBack).not.toHaveBeenCalled();
      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.getByText("Galeria")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("attaches to the same in-flight intent across a StrictMode replay", async () => {
      const captured = createMockFile();
      const deferred = Promise.withResolvers<PhotoOutcome>();
      mockTakeNativePhoto.mockReturnValue(deferred.promise);

      render(
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
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
        <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} initialSource="camera" />,
      );
      await flushMicrotasks();

      expect(screen.getByAltText("Foto da nota fiscal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Trocar foto"));
      await flushMicrotasks();

      expect(mockTakeNativePhoto).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.getByText("Galeria")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
