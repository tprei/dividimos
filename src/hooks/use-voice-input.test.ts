import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { nativeSpeechAvailable, startNativeListening, nativeSpeechSupported } = vi.hoisted(() => ({
  nativeSpeechAvailable: vi.fn(() => false),
  startNativeListening: vi.fn(),
  nativeSpeechSupported: vi.fn(async () => false),
}));
vi.mock("@/lib/capacitor/speech", () => ({
  isNativeSpeechAvailable: () => nativeSpeechAvailable(),
  startNativeListening,
  isNativeSpeechSupported: nativeSpeechSupported,
}));

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
  nativeSpeechAvailable.mockReturnValue(false);
  nativeSpeechSupported.mockResolvedValue(false);
  startNativeListening.mockReset();
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
  it("cancels a native start that has not settled yet", async () => {
    nativeSpeechAvailable.mockReturnValue(true);
    nativeSpeechSupported.mockResolvedValue(true);
    const { promise, resolve } = Promise.withResolvers<{
      kind: "started";
      stop: () => Promise<void>;
    }>();
    const nativeStop = vi.fn(async () => undefined);
    startNativeListening.mockReturnValue(promise);

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {});
    expect(result.current.engine).toBe("native");

    act(() => result.current.startListening());
    act(() => result.current.stopListening());

    resolve({ kind: "started", stop: nativeStop });
    await act(async () => {
      await promise;
    });

    expect(nativeStop).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(false);
  });

  it("reports no support and ignores start while the native probe is pending", async () => {
    nativeSpeechAvailable.mockReturnValue(true);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    nativeSpeechSupported.mockImplementation(() => promise);

    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.engine).toBe("none");

    act(() => result.current.startListening());
    expect(startNativeListening).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);

    await act(async () => {
      resolve(true);
    });
    expect(result.current.isSupported).toBe(true);
    expect(result.current.engine).toBe("native");
  });

  it("starts through the picked web engine when the native probe reports no recognizer", async () => {
    nativeSpeechAvailable.mockReturnValue(true);
    nativeSpeechSupported.mockResolvedValue(false);

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {});
    expect(result.current.engine).toBe("web-speech");

    act(() => result.current.startListening());

    expect(startNativeListening).not.toHaveBeenCalled();
    expect(mockInstance.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
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


  it("does not set error for aborted (silent dismiss)", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());
    act(() => mockInstance._emitError("aborted"));

    expect(result.current.error).toBeNull();
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

  it("ignores deferred onend from an aborted instance when a new session has started", () => {
    let instance1OnEnd: (() => void) | null = null;

    const deferredAbortCtor = function () {
      const instance = createMockRecognition();
      instance.abort = vi.fn(function (this: typeof instance) {
        instance1OnEnd = this.onend;
      });
      instance.start = vi.fn(function (this: typeof instance) {
        this.onstart?.();
      });
      deferredAbortCtor.callCount++;
      mockInstance = instance;
      return instance;
    } as unknown as { new (): ReturnType<typeof createMockRecognition>; callCount: number };
    deferredAbortCtor.callCount = 0;

    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: deferredAbortCtor,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceInput());

    act(() => result.current.startListening());
    const instance2Ref = { current: mockInstance };

    act(() => result.current.startListening());
    const instance2 = mockInstance;

    expect(instance2Ref.current).not.toBe(instance2);
    expect(result.current.isListening).toBe(true);

    act(() => {
      instance1OnEnd?.();
    });

    expect(result.current.isListening).toBe(true);
  });

  it("sets error and clears ref when recognition.start() throws", () => {
    const throwingCtor = function () {
      const instance = createMockRecognition();
      instance.start = vi.fn(() => {
        throw new Error("not allowed");
      });
      mockInstance = instance;
      return instance;
    } as unknown as { new (): ReturnType<typeof createMockRecognition>; callCount: number };
    throwingCtor.callCount = 0;

    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: throwingCtor,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    expect(result.current.error).toBe(
      "Reconhecimento de voz não disponível neste navegador.",
    );
    expect(result.current.isListening).toBe(false);

    // Subsequent startListening should work without abort() on null ref
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: MockSpeechRecognition,
      writable: true,
      configurable: true,
    });
    act(() => result.current.startListening());
    expect(result.current.error).toBeNull();
  });

  it("concatenates multiple final results in a single onresult event", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    act(() => {
      mockInstance._emitResult([
        { transcript: "uber ", isFinal: true, 0: { transcript: "uber " } },
        {
          transcript: "com João",
          isFinal: true,
          0: { transcript: "com João" },
        },
      ]);
    });

    expect(result.current.transcript).toBe("uber com João");
    expect(result.current.interimTranscript).toBe("");
  });

  it("concatenates mixed final and interim results in a single onresult event", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    act(() => {
      mockInstance._emitResult([
        { transcript: "uber ", isFinal: true, 0: { transcript: "uber " } },
        {
          transcript: "com João",
          isFinal: false,
          0: { transcript: "com João" },
        },
      ]);
    });

    expect(result.current.transcript).toBe("uber ");
    expect(result.current.interimTranscript).toBe("com João");
  });

  it("stopListening when not listening is a no-op", () => {
    const { result } = renderHook(() => useVoiceInput());

    // Should not throw or change any state
    act(() => result.current.stopListening());

    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.transcript).toBe("");
  });

  it("handles rapid start/stop cycling without leaked state", () => {
    const { result } = renderHook(() => useVoiceInput());

    // Rapid cycle 1
    act(() => result.current.startListening());
    act(() => result.current.stopListening());

    // Rapid cycle 2
    act(() => result.current.startListening());
    act(() => result.current.stopListening());

    // Rapid cycle 3
    act(() => result.current.startListening());

    expect(result.current.isListening).toBe(true);
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBeNull();

    // Silence timer from earlier cycles should not fire and interfere
    act(() => vi.advanceTimersByTime(3000));

    // Only the latest instance's stop should be called
    expect(result.current.isListening).toBe(false);
  });

  it("does not update transcript when only interim (isFinal: false) results arrive", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.startListening());

    act(() => {
      mockInstance._emitResult([
        { transcript: "ub", isFinal: false, 0: { transcript: "ub" } },
      ]);
    });
    expect(result.current.transcript).toBe("");
    expect(result.current.interimTranscript).toBe("ub");

    act(() => {
      mockInstance._emitResult([
        { transcript: "uber", isFinal: false, 0: { transcript: "uber" } },
      ]);
    });
    expect(result.current.transcript).toBe("");
    expect(result.current.interimTranscript).toBe("uber");

    // On end, interim text is promoted to transcript
    act(() => mockInstance._emitEnd());
    expect(result.current.transcript).toBe("uber");
    expect(result.current.interimTranscript).toBe("");
    expect(result.current.isListening).toBe(false);
  });
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const TRANSCRIBE_HEADERS = { "content-type": "application/json" };

function transcriptResponse(transcript: string): Response {
  return new Response(JSON.stringify({ transcript }), {
    status: 200,
    headers: TRANSCRIBE_HEADERS,
  });
}

interface MockRecorderInstance {
  state: string;
  mimeType: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

describe("useVoiceInput recorder engine", () => {
  let recorderInstances: MockRecorderInstance[];
  let analyserAmplitude: number;
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let mockTrack: { stop: ReturnType<typeof vi.fn> };
  let mockStream: { getTracks: () => { stop: ReturnType<typeof vi.fn> }[] };
  const MockMediaRecorder = vi.fn(function (
    this: unknown,
    _stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    const instance: MockRecorderInstance = {
      state: "inactive",
      mimeType: options?.mimeType ?? "audio/mp4",
      start: vi.fn(function (this: MockRecorderInstance) {
        this.state = "recording";
      }),
      stop: vi.fn(function (this: MockRecorderInstance) {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["x"], { type: this.mimeType }),
        });
        this.onstop?.();
      }),
      ondataavailable: null,
      onstop: null,
      onerror: null,
    };
    recorderInstances.push(instance);
    return instance;
  }) as unknown as {
    new (
      stream?: MediaStream,
      options?: { mimeType?: string },
    ): MockRecorderInstance;
    isTypeSupported: (type: string) => boolean;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    recorderInstances = [];
    analyserAmplitude = 0;
    mockTrack = { stop: vi.fn() };
    mockStream = { getTracks: () => [mockTrack] };
    getUserMediaMock = vi.fn(async () => mockStream);

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(
        (cb: FrameRequestCallback): number =>
          window.setTimeout(() => cb(Date.now()), 16) as unknown as number,
      ),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => window.clearTimeout(id)),
    );

    MockMediaRecorder.isTypeSupported = (type: string) =>
      ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].includes(type);
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "MediaRecorder", {
      value: MockMediaRecorder,
      writable: true,
      configurable: true,
    });
    class MockAudioContext {
      state = "running";
      destination = {};
      sampleRate = 48000;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          getFloatTimeDomainData: (buffer: Float32Array) => {
            buffer.fill(analyserAmplitude);
          },
        };
      }
      close = vi.fn(async () => undefined);
    }
    Object.defineProperty(window, "AudioContext", {
      value: MockAudioContext,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.defineProperty(window, "MediaRecorder", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "AudioContext", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  function installAppleMobileWebKit() {
    Object.defineProperty(window.navigator, "userAgent", {
      value: IPHONE_UA,
      configurable: true,
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: 5,
      configurable: true,
    });
  }

  it("reports the recorder engine when only MediaRecorder exists", () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.engine).toBe("recorder");
    expect(result.current.isSupported).toBe(true);
  });

  it("never constructs SpeechRecognition on Apple mobile WebKit", async () => {
    installAppleMobileWebKit();
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.engine).toBe("recorder");

    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    expect(MockSpeechRecognition.callCount).toBe(0);
    expect(recorderInstances).toHaveLength(1);
    expect(recorderInstances[0].start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(result.current.phase).toBe("listening");
  });

  it("routes a native shell whose probe reports no recognizer to the recorder", async () => {
    installAppleMobileWebKit();
    nativeSpeechAvailable.mockReturnValue(true);
    nativeSpeechSupported.mockResolvedValue(false);

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {});
    expect(result.current.engine).toBe("recorder");

    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    expect(startNativeListening).not.toHaveBeenCalled();
    expect(recorderInstances).toHaveLength(1);
    expect(result.current.isListening).toBe(true);
  });

  it("resumes an AudioContext that starts suspended", async () => {
    const resumeSpy = vi.fn(async () => undefined);
    class SuspendedAudioContext {
      state = "suspended";
      destination = {};
      sampleRate = 48000;
      resume = resumeSpy;
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          getFloatTimeDomainData: (buffer: Float32Array) => {
            buffer.fill(analyserAmplitude);
          },
        };
      }
      close = vi.fn(async () => undefined);
    }
    Object.defineProperty(window, "AudioContext", {
      value: SuspendedAudioContext,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    expect(resumeSpy).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(true);
  });

  it("records, stops, transcribes and delivers the transcript", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: { method?: string; body?: FormData }) => Promise<Response>
    >(async () => transcriptResponse("Uber com João 25 reais"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    act(() => result.current.stopListening());

    expect(result.current.phase).toBe("transcribing");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/voice/transcribe");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(init?.body?.get("audio")).toBeInstanceOf(Blob);

    await act(async () => {});

    expect(result.current.transcript).toBe("Uber com João 25 reais");
    expect(result.current.phase).toBe("idle");
    expect(result.current.isListening).toBe(false);
    expect(result.current.level).toBe(0);
  });

  it("picks audio/mp4 when the browser reports support for it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => transcriptResponse("oi")));
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    expect(recorderInstances[0].mimeType).toBe("audio/mp4");
  });

  it("auto-stops once speech is followed by 1.8s of silence", async () => {
    const fetchMock = vi.fn(async () => transcriptResponse("oi"));
    vi.stubGlobal("fetch", fetchMock);
    analyserAmplitude = 0.1;
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    act(() => vi.advanceTimersByTime(200));
    expect(result.current.level).toBeGreaterThan(0);

    analyserAmplitude = 0;
    act(() => vi.advanceTimersByTime(2000));

    expect(recorderInstances[0].stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("transcribing");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("hard-caps a silent recording at 15 seconds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => transcriptResponse("oi")));
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    act(() => vi.advanceTimersByTime(14_000));
    expect(recorderInstances[0].stop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_500));
    expect(recorderInstances[0].stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("transcribing");
  });

  it("maps permission denial to the PT-BR message", async () => {
    getUserMediaMock.mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value.catch(() => null);
    });

    expect(result.current.error).toBe(
      "Permissão do microfone negada. Libere nas configurações do navegador.",
    );
    expect(result.current.isListening).toBe(false);
    expect(result.current.phase).toBe("idle");
  });

  it("cleans up tracks and timers on unmount while listening", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => transcriptResponse("oi")));
    const { result, unmount } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });
    expect(result.current.isListening).toBe(true);

    unmount();

    expect(recorderInstances[0].stop).toHaveBeenCalled();
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
  });

  it("aborts an in-flight transcription on unmount and never sets state after", async () => {
    let capturedSignal: AbortSignal | undefined;
    const { promise, resolve } = Promise.withResolvers<Response>();
    const fetchMock = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal;
      return promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useVoiceInput());
    await act(async () => {
      result.current.startListening();
      await getUserMediaMock.mock.results[0]!.value;
    });

    act(() => result.current.stopListening());
    expect(result.current.phase).toBe("transcribing");

    unmount();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);

    await act(async () => {
      resolve(transcriptResponse("chegou tarde"));
      await promise;
    });

    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBeNull();
  });
});
