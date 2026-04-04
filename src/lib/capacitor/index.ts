import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { createClient } from "@/lib/supabase/client";
import { configureStatusBar } from "./status-bar";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function consumeAuthTokens(): Promise<void> {
  const raw = localStorage.getItem("__cap_auth");
  if (!raw) return;
  localStorage.removeItem("__cap_auth");
  const { access_token, refresh_token, onboard } = JSON.parse(raw);
  if (access_token && refresh_token) {
    const supabase = createClient();
    await supabase.auth.setSession({ access_token, refresh_token });
    window.location.href = onboard ? "/auth/onboard" : "/app";
  }
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

  Browser.addListener("browserFinished", () => {
    consumeAuthTokens();
  });

  App.addListener("resume", () => {
    consumeAuthTokens();
  });
}

export async function hideSplash(): Promise<void> {
  if (!isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
