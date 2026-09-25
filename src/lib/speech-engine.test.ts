import { describe, expect, it } from "vitest";
import {
  isAppleMobileWebKit,
  pickSpeechEngine,
  type SpeechEngineEnv,
} from "./speech-engine";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("isAppleMobileWebKit", () => {
  it.each([
    ["iPhone UA with touch", IPHONE_UA, 5, true],
    ["iPad UA with touch", IPAD_UA, 5, true],
    ["iPadOS desktop UA with touch", IPAD_DESKTOP_UA, 5, true],
    ["real Mac (no touch)", MAC_UA, 0, false],
    ["Windows desktop", CHROME_UA, 0, false],
    ["Android", ANDROID_UA, 5, false],
  ])("%s", (_name, userAgent, maxTouchPoints, expected) => {
    expect(isAppleMobileWebKit({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

describe("pickSpeechEngine", () => {
  const env = (
    overrides: Partial<SpeechEngineEnv> = {},
  ): SpeechEngineEnv => ({
    probePending: false,
    nativeSupported: false,
    hasWebSpeech: false,
    appleMobileWebKit: false,
    hasMediaRecorder: false,
    ...overrides,
  });

  it.each([
    [
      "native wins over every other capability",
      env({ nativeSupported: true, hasWebSpeech: true, appleMobileWebKit: true, hasMediaRecorder: true }),
      "native",
    ],
    [
      "a pending probe keeps the engine undetermined even with every capability",
      env({ probePending: true, nativeSupported: true, hasWebSpeech: true, appleMobileWebKit: true, hasMediaRecorder: true }),
      "none",
    ],
    [
      "Apple mobile uses the recorder even when Web Speech exists",
      env({ hasWebSpeech: true, appleMobileWebKit: true, hasMediaRecorder: true }),
      "recorder",
    ],
    [
      "Apple mobile without MediaRecorder has no engine",
      env({ hasWebSpeech: true, appleMobileWebKit: true }),
      "none",
    ],
    [
      "desktop prefers Web Speech",
      env({ hasWebSpeech: true, hasMediaRecorder: true }),
      "web-speech",
    ],
    [
      "non-Apple browser without Web Speech falls back to the recorder",
      env({ hasMediaRecorder: true }),
      "recorder",
    ],
    ["nothing available means none", env(), "none"],
  ])("%s", (_name, environment, expected) => {
    expect(pickSpeechEngine(environment)).toBe(expected);
  });
});
