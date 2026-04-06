import { Capacitor } from "@capacitor/core";

export function isNativeSpeechAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function startNativeListening(
  onPartial: (text: string) => void,
  onError: (message: string) => void,
  onEnd: () => void,
): Promise<{ stop: () => Promise<void> }> {
  const { SpeechRecognition } = await import(
    "@capgo/capacitor-speech-recognition"
  );

  const permResult = await SpeechRecognition.requestPermissions();
  if (permResult.speechRecognition !== "granted") {
    onError("Permissão do microfone negada. Verifique as configurações.");
    onEnd();
    return { stop: async () => {} };
  }

  const partialHandle = await SpeechRecognition.addListener(
    "partialResults",
    (event) => {
      const text = event.accumulatedText ?? event.matches?.[0] ?? "";
      if (text) onPartial(text);
    },
  );

  const stateHandle = await SpeechRecognition.addListener(
    "listeningState",
    (event) => {
      if (event.state === "stopped") onEnd();
    },
  );

  const errorHandle = await SpeechRecognition.addListener("error", (event) => {
    onError(event.message || "Erro no reconhecimento de voz.");
  });

  await SpeechRecognition.start({
    language: "pt-BR",
    partialResults: true,
    maxResults: 1,
    popup: false,
  });

  return {
    stop: async () => {
      await SpeechRecognition.stop();
      partialHandle.remove();
      stateHandle.remove();
      errorHandle.remove();
    },
  };
}
