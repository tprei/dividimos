import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { configureStatusBar } from "./status-bar";
import { resolveDeepLinkTarget } from "./deep-link";
import { runBackHandlers } from "./back-handler";
import type { NativePlatformVersion } from "@/lib/financial-compatibility";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Parsed Android `versionCode` (iOS `CFBundleVersion`) for the #477
 * compatibility gate. `{ onNative: false }` on web, where there is no
 * native build to compare against `minimumNativeVersionCode`. On native,
 * always `{ onNative: true, versionCode }` — `versionCode` is `null` only
 * when `App.getInfo().build` could not be parsed as an integer, which the
 * gate must treat as unverifiable and fail closed, never as web.
 */
export async function getNativeVersionCode(): Promise<NativePlatformVersion> {
  if (!isNativePlatform()) return { onNative: false };
  const { build } = await App.getInfo();
  const parsed = Number.parseInt(build, 10);
  return { onNative: true, versionCode: Number.isInteger(parsed) ? parsed : null };
}

export async function initCapacitor(): Promise<void> {
  if (!isNativePlatform()) return;

  await configureStatusBar();

  App.addListener("backButton", ({ canGoBack }) => {
    if (runBackHandlers()) return;
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });

  App.addListener("appUrlOpen", ({ url }) => {
    const target = resolveDeepLinkTarget(url);
    if (target) window.location.href = target;
  });
}

export async function hideSplash(): Promise<void> {
  if (!isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
