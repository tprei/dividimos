import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

export async function configureStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await StatusBar.setStyle({ style: Style.Light });

  if (Capacitor.getPlatform() === "android") {
    await StatusBar.setBackgroundColor({ color: "#F9F9FB" });
  }

  await StatusBar.setOverlaysWebView({ overlay: true });
}
