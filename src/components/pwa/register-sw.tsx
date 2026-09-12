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

export function RegisterSW() {
  const router = useRouter();
  useEffect(() => {
    const native = isNativeWebView();

    if (native && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister();
        }
      });
    }

    if (native) {
      import("@/lib/capacitor").then(({ initCapacitor }) => {
        initCapacitor((href) => router.replace(href));
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
