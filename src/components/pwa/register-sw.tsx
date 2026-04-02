"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { initCapacitor, hideSplash } from "@/lib/capacitor";

export function RegisterSW() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
        });
      }
      initCapacitor().then(() => hideSplash());
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
