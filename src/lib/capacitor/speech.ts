import { Capacitor } from "@capacitor/core";

/** How a start attempt settled. Only `started` means the mic is live. */
export type SpeechStartOutcome =
  | { kind: "started"; stop: () => Promise<void> }
  | { kind: "permission_denied" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export function isNativeSpeechAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Whether the device actually offers speech recognition.
 *
 * Running on a native shell is not the same as having a recognizer: gating
 * the voice UI on the platform alone offered a button that could never work.
 */
export async function isNativeSpeechSupported(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { SpeechRecognition } = await import(
      "@capgo/capacitor-speech-recognition"
    );
    const result = await SpeechRecognition.available();
    return result.available === true;
  } catch {
    return false;
  }
}

/**
 * Start native dictation.
 *
 * @returns A settled outcome. Denial and failure are reported as outcomes,
 * never as a handle whose `stop` does nothing, so the caller cannot show a
 * listening state for a microphone that never opened. Listeners are installed
 * only for a start that succeeded, and are removed on stop, on failure, and
 * when the recognizer reports it stopped.
 */
export async function startNativeListening(
  onPartial: (text: string) => void,
  onError: (message: string) => void,
  onEnd: () => void,
): Promise<SpeechStartOutcome> {
  let SpeechRecognition;
  try {
    ({ SpeechRecognition } = await import("@capgo/capacitor-speech-recognition"));
  } catch {
    return { kind: "unavailable" };
  }

  try {
    const permResult = await SpeechRecognition.requestPermissions();
    if (permResult.speechRecognition !== "granted") {
      return { kind: "permission_denied" };
    }
  } catch {
    return { kind: "permission_denied" };
  }

  const handles: { remove: () => Promise<void> }[] = [];
  let ended = false;
  let terminalError: string | null = null;
  const removeAllListeners = () => {
    for (const handle of handles.splice(0)) {
      void handle.remove();
    }
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    removeAllListeners();
    onEnd();
  };

  try {
    handles.push(
      await SpeechRecognition.addListener("partialResults", (event) => {
        const text = event.accumulatedText ?? event.matches?.[0] ?? "";
        if (text) onPartial(text);
      }),
    );

    handles.push(
      await SpeechRecognition.addListener("listeningState", (event) => {
        if (event.state === "stopped") finish();
      }),
    );

    handles.push(
      await SpeechRecognition.addListener("error", (event) => {
        if (ended) return;
        terminalError = event.message || "Erro no reconhecimento de voz.";
        onError(terminalError);
        finish();
      }),
    );

    await SpeechRecognition.start({
      language: "pt-BR",
      partialResults: true,
      maxResults: 1,
      popup: false,
    });
    if (ended) {
      return {
        kind: "error",
        message: terminalError ?? "Reconhecimento terminou antes de iniciar.",
      };
    }
  } catch (cause) {
    removeAllListeners();
    return {
      kind: "error",
      message: cause instanceof Error ? cause.message : "Erro ao iniciar reconhecimento de voz.",
    };
  }

  return {
    kind: "started",
    stop: async () => {
      finish();
      try {
        await SpeechRecognition.stop();
      } catch {
        // The recognizer is already down; the UI leaves listening either way.
      }
    },
  };
}
