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
    it("reports denial as an outcome and installs nothing", async () => {
      mockRequestPermissions.mockResolvedValue({
        speechRecognition: "denied",
      });

      const onPartial = vi.fn();
      const onError = vi.fn();
      const onEnd = vi.fn();

      const { startNativeListening } = await loadModule();
      const result = await startNativeListening(onPartial, onError, onEnd);

      // A denial that resolved a no-op handle let the UI claim it was
      // listening to a microphone that never opened.
      expect(result.kind).toBe("permission_denied");
      expect(onError).not.toHaveBeenCalled();
      expect(onEnd).not.toHaveBeenCalled();
      expect(mockAddListener).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("handles prompt-denied permission", async () => {
      mockRequestPermissions.mockResolvedValue({
        speechRecognition: "prompt",
      });

      const onError = vi.fn();
      const onEnd = vi.fn();

      const { startNativeListening } = await loadModule();
      const outcome = await startNativeListening(vi.fn(), onError, onEnd);

      expect(outcome.kind).toBe("permission_denied");
      expect(onError).not.toHaveBeenCalled();
      expect(onEnd).not.toHaveBeenCalled();
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

    it("forwards terminal errors and ends the session", async () => {
      const onError = vi.fn();
      const onEnd = vi.fn();
      let errorHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "error") errorHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );

      const { startNativeListening } = await loadModule();
      await startNativeListening(vi.fn(), onError, onEnd);

      errorHandler!({ message: "mic unavailable" });
      expect(onError).toHaveBeenCalledWith("mic unavailable");
      expect(onEnd).toHaveBeenCalledTimes(1);
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
    it("returns a failed outcome when the recognizer ends before start settles", async () => {
      let stateHandler: (event: Record<string, unknown>) => void;
      mockAddListener.mockImplementation(
        (event: string, handler: (event: Record<string, unknown>) => void) => {
          if (event === "listeningState") stateHandler = handler;
          return Promise.resolve({ remove: vi.fn() });
        },
      );
      mockStart.mockImplementation(async () => {
        stateHandler!({ state: "stopped" });
      });

      const onEnd = vi.fn();
      const { startNativeListening } = await loadModule();
      const outcome = await startNativeListening(vi.fn(), vi.fn(), onEnd);

      expect(outcome.kind).toBe("error");
      expect(onEnd).toHaveBeenCalledTimes(1);
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
      if (result.kind !== "started") throw new Error("expected a started outcome");

      await result.stop();

      expect(mockStop).toHaveBeenCalledTimes(1);
      // Stopping releases the handles itself, so a session that ends without
      // a "stopped" event still leaves nothing installed.
      expect(removePartial).toHaveBeenCalledTimes(1);
      expect(removeState).toHaveBeenCalledTimes(1);
      expect(removeError).toHaveBeenCalledTimes(1);
    });
    it("completes cleanup when plugin stop rejects", async () => {
      const onEnd = vi.fn();
      mockStop.mockRejectedValueOnce(new Error("already stopped"));

      const { startNativeListening } = await loadModule();
      const result = await startNativeListening(vi.fn(), vi.fn(), onEnd);
      if (result.kind !== "started") throw new Error("expected a started outcome");

      await expect(result.stop()).resolves.toBeUndefined();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("failed start", () => {
    it("removes its listeners so retries do not accumulate handles", async () => {
      const removes: ReturnType<typeof vi.fn>[] = [];
      mockAddListener.mockImplementation(() => {
        const remove = vi.fn();
        removes.push(remove);
        return Promise.resolve({ remove });
      });
      mockStart.mockRejectedValue(new Error("recognizer busy"));

      const { startNativeListening } = await loadModule();
      const first = await startNativeListening(vi.fn(), vi.fn(), vi.fn());
      const second = await startNativeListening(vi.fn(), vi.fn(), vi.fn());

      expect(first.kind).toBe("error");
      expect(second.kind).toBe("error");
      // Every listener installed by a failed attempt is released; otherwise
      // each retry stacks another set on the plugin.
      expect(removes).toHaveLength(6);
      for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
