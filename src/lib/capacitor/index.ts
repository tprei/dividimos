import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { configureStatusBar } from "./status-bar";
import { resolveDeepLinkTarget } from "./deep-link";
import { runBackHandlers } from "./back-handler";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Parsed Android `versionCode` (iOS `CFBundleVersion`) for the #477
 * compatibility gate. Returns `null` on web, where there is no native
 * build to compare against `minimumNativeVersionCode`.
 */
export async function getNativeVersionCode(): Promise<number | null> {
  if (!isNativePlatform()) return null;
  const { build } = await App.getInfo();
  const parsed = Number.parseInt(build, 10);
  return Number.isInteger(parsed) ? parsed : null;
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
