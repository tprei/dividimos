import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { createClient } from "@/lib/supabase/client";
import { configureStatusBar } from "./status-bar";

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

  App.addListener("appUrlOpen", async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/complete" || parsed.host === "auth") {
      const accessToken = parsed.searchParams.get("access_token");
      const refreshToken = parsed.searchParams.get("refresh_token");
      const needsOnboarding = parsed.searchParams.get("onboard") === "1";
      if (accessToken && refreshToken) {
        await Browser.close();
        const supabase = createClient();
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        window.location.href = needsOnboarding ? "/auth/onboard" : "/app";
      }
    }
  });
}

export async function hideSplash(): Promise<void> {
  if (!isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
