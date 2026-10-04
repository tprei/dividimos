import { Capacitor } from "@capacitor/core";

/**
 * iOS never asks for a permission again after a refusal, so the app's page in
 * Ajustes is the only way back. Capacitor hands URLs outside the app to the
 * system, which opens `app-settings:` (UIApplication.openSettingsURLString).
 */
export function opensAppSettings(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function openAppSettings(): void {
  window.location.assign("app-settings:");
}
