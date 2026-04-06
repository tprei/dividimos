import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput } from "./use-voice-input";

type ResultEntry = { transcript: string; isFinal: boolean; 0: { transcript: string } };

function createMockRecognition() {
  const instance = {
    lang: "",
    continuous: false,
    interimResults: false,
    maxAlternatives: 1,
    onstart: null as (() => void) | null,
    onresult: null as ((e: unknown) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: vi.fn(function (this: typeof instance) {
      this.onstart?.();
    }),
    stop: vi.fn(function (this: typeof instance) {
      this.onend?.();
    }),
    abort: vi.fn(function (this: typeof instance) {
      this.onend?.();
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    // Helpers for tests
    _emitResult(results: ResultEntry[]) {
      const resultList = results as unknown as SpeechRecognitionResultList;
      Object.defineProperty(resultList, "length", { value: results.length });
      this.onresult?.({ results: resultList, resultIndex: 0 });
    },
    _emitError(error: string) {
      this.onerror?.({ error });
    },
    _emitEnd() {
      this.onend?.();
    },
  };
  return instance;
}

let mockInstance: ReturnType<typeof createMockRecognition>;
let MockSpeechRecognition: { new (): ReturnType<typeof createMockRecognition>; callCount: number };

function makeMockCtor() {
  // Constructor that returns an explicit object — `new Ctor()` returns the mock
  const ctor = function () {
    mockInstance = createMockRecognition();
    ctor.callCount++;
    return mockInstance;
  } as unknown as { new (): ReturnType<typeof createMockRecognition>; callCount: number };
  ctor.callCount = 0;
  return ctor;
}

beforeEach(() => {
  vi.useFakeTimers();
  MockSpeechRecognition = makeMockCtor();
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: MockSpeechRecognition,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: undefined,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "SpeechRecognition", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

describe("useVoiceInput", () => {
  it("reports isSupported=true when webkitSpeechRecognition exists", () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(true);
  });

  it("reports isSupported=false when no SpeechRecognition exists", () => {
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(false);
  });

  it("starts listening and configures pt-BR", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    expect(mockInstance.lang).toBe("pt-BR");
    expect(mockInstance.continuous).toBe(true);
    expect(mockInstance.interimResults).toBe(true);
    expect(mockInstance.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });

  it("captures final transcript from results", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    act(() => {
      mockInstance._emitResult([
        { transcript: "uber com João", isFinal: true, 0: { transcript: "uber com João" } },
      ]);
    });

    expect(result.current.transcript).toBe("uber com João");
    expect(result.current.interimTranscript).toBe("");
  });

  it("captures interim transcript from results", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    act(() => {
      mockInstance._emitResult([
        { transcript: "uber", isFinal: false, 0: { transcript: "uber" } },
      ]);
    });

    expect(result.current.interimTranscript).toBe("uber");
    expect(result.current.transcript).toBe("");
  });

  it("stops listening on manual stop", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => result.current.stopListening());

    expect(result.current.isListening).toBe(false);
  });

  it("auto-stops after 3s silence", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    expect(result.current.isListening).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockInstance.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it("resets silence timer on new speech results", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    // Advance 2s — should still be listening
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.isListening).toBe(true);

    // New result resets the timer
    act(() => {
      mockInstance._emitResult([
        { transcript: "uber", isFinal: false, 0: { transcript: "uber" } },
      ]);
    });

    // Advance another 2s — should still be listening (timer was reset)
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.isListening).toBe(true);

    // Advance 1 more second (total 3s since last result) — should stop
    act(() => vi.advanceTimersByTime(1000));
    expect(mockInstance.stop).toHaveBeenCalled();
  });

  it("sets user-friendly error for not-allowed", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("not-allowed"));

    expect(result.current.error).toContain("Permissão do microfone negada");
  });

  it("sets user-friendly error for no-speech", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("no-speech"));

    expect(result.current.error).toContain("Nenhuma fala detectada");
  });

  it("sets user-friendly error for network error", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("network"));

    expect(result.current.error).toContain("Erro de rede");
  });

  it("sets user-friendly error for audio-capture", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("audio-capture"));

    expect(result.current.error).toContain("Nenhum microfone encontrado");
  });

  it("does not set error for aborted (silent dismiss)", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("aborted"));

    expect(result.current.error).toBeNull();
  });

  it("sets generic error for unknown error codes", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("something-unknown"));

    expect(result.current.error).toContain("Erro no reconhecimento de voz");
  });

  it("clears state when starting a new session", () => {
    const { result } = renderHook(() => useVoiceInput());

    // First session with results
    act(() => result.current.startListening());
    act(() => {
      mockInstance._emitResult([
        { transcript: "teste", isFinal: true, 0: { transcript: "teste" } },
      ]);
    });
    act(() => result.current.stopListening());

    expect(result.current.transcript).toBe("teste");

    // New session clears previous state
    act(() => result.current.startListening());
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("cleans up recognition on unmount", () => {
    const { result, unmount } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    unmount();
    expect(mockInstance.abort).toHaveBeenCalled();
  });

  it("does nothing when startListening is called and unsupported", () => {
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    expect(result.current.isListening).toBe(false);
  });

  it("prefers standard SpeechRecognition over webkit prefix", () => {
    const StandardMock = makeMockCtor();
    Object.defineProperty(window, "SpeechRecognition", {
      value: StandardMock,
      writable: true,
      configurable: true,
    });
    MockSpeechRecognition.callCount = 0;

    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    expect(StandardMock.callCount).toBe(1);
    expect(MockSpeechRecognition.callCount).toBe(0);
  });
});
