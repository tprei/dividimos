import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function openOAuthInSystemBrowser(url: string): Promise<void> {
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

export async function closeSystemBrowser(): Promise<void> {
  await Browser.close();
}
