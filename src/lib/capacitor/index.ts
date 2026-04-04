import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { createClient } from "@/lib/supabase/client";
import { configureStatusBar } from "./status-bar";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function claimNativeSession() {
  const state = localStorage.getItem("__cap_oauth_state");
  if (!state) return;
  const res = await fetch(`/api/auth/native-session?state=${state}`);
  if (!res.ok) return;
  localStorage.removeItem("__cap_oauth_state");
  const { access_token, refresh_token } = await res.json();
  const supabase = createClient();
  await supabase.auth.setSession({ access_token, refresh_token });
  await supabase.auth.refreshSession();
  window.location.href = "/app";
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

  Browser.addListener("browserFinished", claimNativeSession);
  App.addListener("resume", claimNativeSession);
}

export async function hideSplash(): Promise<void> {
  if (!isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
