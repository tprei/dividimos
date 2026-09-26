export type SpeechEngine = "native" | "web-speech" | "recorder" | "none";

/** The environment facts the engine choice is made from. */
export interface SpeechEngineEnv {
  /** Native-recognizer probe still running; the engine is undetermined. */
  probePending: boolean;
  nativeSupported: boolean;
  hasWebSpeech: boolean;
  appleMobileWebKit: boolean;
  hasMediaRecorder: boolean;
}

/**
 * Apple mobile WebKit: iPhone/iPod/iPad Safari and home-screen web apps,
 * including iPads that report a desktop `Macintosh` UA (iPadOS 13+ desktop
 * mode) — those are separated from real Macs by touch input. Speech
 * recognition is broken in this family (the constructor exists but `start()`
 * can hang without ever firing `onstart`/`onresult`/`onerror`/`onend`),
 * most visibly in standalone PWAs.
 */
export function isAppleMobileWebKit(
  nav: Pick<Navigator, "userAgent" | "maxTouchPoints">,
): boolean {
  return (
    /iP(hone|od|ad)/.test(nav.userAgent) ||
    (nav.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent))
  );
}

/**
 * Engine decision table. Native (Capacitor) wins whenever the plugin confirms
 * support. On Apple mobile WebKit the Web Speech API is never trusted, so the
 * only options are the MediaRecorder engine or none. Elsewhere Web Speech is
 * preferred and MediaRecorder is the fallback.
 */
export function pickSpeechEngine(env: SpeechEngineEnv): SpeechEngine {
  // While the native probe runs, the engine is undetermined: on a native
  // shell the answer decides between the plugin and the web engines, and
  // picking either early hands the user a control that cannot work there.
  if (env.probePending) return "none";
  if (env.nativeSupported) return "native";
  if (env.appleMobileWebKit) {
    return env.hasMediaRecorder ? "recorder" : "none";
  }
  if (env.hasWebSpeech) return "web-speech";
  return env.hasMediaRecorder ? "recorder" : "none";
}
