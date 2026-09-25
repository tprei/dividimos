import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { THEME_COLORS, type ResolvedTheme } from "../theme";

export async function configureStatusBar(theme: ResolvedTheme): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });

  if (Capacitor.getPlatform() === "android") {
    await StatusBar.setBackgroundColor({ color: THEME_COLORS[theme] });
  }

  await StatusBar.setOverlaysWebView({ overlay: true });
}
