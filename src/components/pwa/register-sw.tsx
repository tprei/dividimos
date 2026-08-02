"use client";

import { useRouter } from "next/navigation";
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
      navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, [router]);

  return null;
}
