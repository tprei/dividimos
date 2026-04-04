import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

export async function configureStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Light });

    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#F9F9FB" });
    }

    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // StatusBar plugin unavailable — bridge version mismatch
  }
}
