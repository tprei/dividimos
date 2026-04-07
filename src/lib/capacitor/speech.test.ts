import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsNativePlatform = vi.fn(() => true);
const mockRequestPermissions = vi.fn();
const mockAddListener = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
  },
}));

vi.mock("@capgo/capacitor-speech-recognition", () => ({
  SpeechRecognition: {
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
    start: (...args: unknown[]) => mockStart(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  mockRequestPermissions.mockResolvedValue({
    speechRecognition: "granted",
  });
  mockAddListener.mockResolvedValue({ remove: vi.fn() });
  mockStart.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
});

async function loadModule() {
  return import("./speech");
}

describe("isNativeSpeechAvailable", () => {
  it("returns true on native platform", async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const { isNativeSpeechAvailable } = await loadModule();
    expect(isNativeSpeechAvailable()).toBe(true);
  });

  it("returns false on web", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    const { isNativeSpeechAvailable } = await loadModule();
    expect(isNativeSpeechAvailable()).toBe(false);
  });
});

describe("startNativeListening", () => {
  describe("permission denied", () => {
    it("calls onError and onEnd, returns no-op stop", async () => {
      mockRequestPermissions.mockResolvedValue({
        speechRecognition: "denied",
      });

      const onPartial = vi.fn();
      const onError = vi.fn();
      const onEnd = vi.fn();

      const { startNativeListening } = await loadModule();
      const result = await startNativeListening(onPartial, onError, onEnd);

      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Permissão"),
      );
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(mockAddListener).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();

      // stop is a no-op — should not throw
      await result.stop();
      expect(mockStop).not.toHaveBeenCalled();
    });

    it("handles prompt-denied permission", async () => {
      mockRequestPermissions.mockResolvedValue({
        speechRecognition: "prompt",
      });

      const onError = vi.fn();
      const onEnd = vi.fn();

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), onError, onEnd);

      expect(onError).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();
    });
  });

  describe("permission granted", () => {
    it("registers listeners and starts with correct options", async () => {
      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), vi.fn(), vi.fn());

      expect(mockAddListener).toHaveBeenCalledTimes(3);
      expect(mockAddListener).toHaveBeenCalledWith(
        "partialResults",
        expect.any(Function),
      );
      expect(mockAddListener).toHaveBeenCalledWith(
        "listeningState",
        expect.any(Function),
      );
      expect(mockAddListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
      );

      expect(mockStart).toHaveBeenCalledWith({
        language: "pt-BR",
        partialResults: true,
        maxResults: 1,
        popup: false,
      });
    });

    it("forwards partialResults with accumulatedText", async () => {
      const onPartial = vi.fn();
      let partialHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "partialResults") partialHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(onPartial, vi.fn(), vi.fn());

      partialHandler!({ accumulatedText: "olá mundo" });
      expect(onPartial).toHaveBeenCalledWith("olá mundo");
    });

    it("falls back to matches[0] when accumulatedText is absent", async () => {
      const onPartial = vi.fn();
      let partialHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "partialResults") partialHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(onPartial, vi.fn(), vi.fn());

      partialHandler!({ matches: ["fallback text"] });
      expect(onPartial).toHaveBeenCalledWith("fallback text");
    });

    it("does not call onPartial for empty text", async () => {
      const onPartial = vi.fn();
      let partialHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "partialResults") partialHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(onPartial, vi.fn(), vi.fn());

      partialHandler!({});
      expect(onPartial).not.toHaveBeenCalled();

      partialHandler!({ accumulatedText: "", matches: [] });
      expect(onPartial).not.toHaveBeenCalled();
    });

    it("forwards errors to onError", async () => {
      const onError = vi.fn();
      let errorHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "error") errorHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), onError, vi.fn());

      errorHandler!({ message: "mic unavailable" });
      expect(onError).toHaveBeenCalledWith("mic unavailable");
    });

    it("uses fallback error message when event.message is empty", async () => {
      const onError = vi.fn();
      let errorHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "error") errorHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), onError, vi.fn());

      errorHandler!({});
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Erro"),
      );
    });

    it("calls onEnd when listeningState becomes stopped", async () => {
      const onEnd = vi.fn();
      let stateHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "listeningState") stateHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), vi.fn(), onEnd);

      stateHandler!({ state: "stopped" });
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it("does not call onEnd for non-stopped states", async () => {
      const onEnd = vi.fn();
      let stateHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "listeningState") stateHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), vi.fn(), onEnd);

      stateHandler!({ state: "started" });
      stateHandler!({ state: "listening" });
      expect(onEnd).not.toHaveBeenCalled();
    });
  });

  describe("stop()", () => {
    it("calls plugin stop and removes all listeners", async () => {
      const removePartial = vi.fn();
      const removeState = vi.fn();
      const removeError = vi.fn();
      const removes = [removePartial, removeState, removeError];
      let callIndex = 0;

      mockAddListener.mockImplementation(() => {
        const remove = removes[callIndex++];
        return Promise.resolve({ remove });
      });

      const { startNativeListening } = await loadModule();
      const result = await startNativeListening(vi.fn(), vi.fn(), vi.fn());

      await result.stop();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(removePartial).toHaveBeenCalledTimes(1);
      expect(removeState).toHaveBeenCalledTimes(1);
      expect(removeError).toHaveBeenCalledTimes(1);
    });
  });
});
