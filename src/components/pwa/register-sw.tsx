"use client";

import { useRouter } from "next/navigation";
import { registerServiceWorker } from "@/lib/push/service-worker";
import { useEffect } from "react";

function isNativeWebView(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.androidBridge !== "undefined") return true;
  const webkit = w.webkit as Record<string, Record<string, unknown>> | undefined;
  return typeof webkit?.messageHandlers?.bridge !== "undefined";
}

const HANDOFF_KEY = "dividimos.sw.handoff";

/**
 * Removes any service worker left over from the web install.
 *
 * Returns whether the document is still controlled afterwards: unregistering
 * does not detach the current page, and a controlled page keeps serving the
 * cached web shell to the native WebView.
 */
async function releaseServiceWorker(): Promise<boolean> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const results = await Promise.all(
    registrations.map((reg) => reg.unregister()),
  );
  if (results.some((ok) => !ok)) {
    throw new Error("a service worker refused to unregister");
  }
  return navigator.serviceWorker.controller !== null;
}

export function RegisterSW() {
  const router = useRouter();
  useEffect(() => {
    const native = isNativeWebView();

    if (native) {
      const startNative = () =>
        import("@/lib/capacitor").then(({ initCapacitor }) => {
          initCapacitor((href) => router.replace(href));
        });

      if (!("serviceWorker" in navigator)) {
        void startNative();
        return;
      }

      // Capacitor must not start while a web service worker can still answer
      // navigations, so the teardown is awaited rather than fired off.
      void releaseServiceWorker()
        .then((stillControlled) => {
          if (stillControlled && !sessionStorage.getItem(HANDOFF_KEY)) {
            // One reload, recorded so a worker that somehow survives cannot
            // turn this into a loop.
            sessionStorage.setItem(HANDOFF_KEY, "1");
            window.location.reload();
            return undefined;
          }
          return startNative();
        })
        .catch((error: unknown) => {
          console.error("[pwa] could not release the service worker:", error);
          return startNative();
        });
      return;
    }

    if ("serviceWorker" in navigator) {
      // Registration is owned by the push module so activation failures reach
      // the controls that depend on them instead of vanishing.
      registerServiceWorker().catch((error: unknown) => {
        console.error("[pwa] service worker registration failed:", error);
      });
    }
  }, [router]);

  return null;
}
