import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { configureStatusBar } from "./status-bar";
import { resolveDeepLinkTarget } from "./deep-link";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initCapacitor(): Promise<void> {
  if (!isNativePlatform()) return;

  await configureStatusBar();

  App.addListener("backButton", ({ canGoBack }) => {
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
