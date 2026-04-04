"use client";

import { useEffect } from "react";

function isNativeWebView(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.androidBridge !== "undefined") return true;
  const webkit = w.webkit as Record<string, Record<string, unknown>> | undefined;
  return typeof webkit?.messageHandlers?.bridge !== "undefined";
}

export function RegisterSW() {
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
        initCapacitor();
      });
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
