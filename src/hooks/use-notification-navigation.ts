"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { resolveNotificationDestination } from "@/lib/push/notification-destination";

interface NotificationNavigateMessage {
  type: "notification-navigate";
  url: string;
}

function isNotificationNavigateMessage(
  data: unknown,
): data is NotificationNavigateMessage {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return record.type === "notification-navigate" && typeof record.url === "string";
}

/**
 * Routes web push notification taps to the open window.
 *
 * The service worker cannot call `WindowClient.navigate()` on iOS WebKit, so
 * it posts a `notification-navigate` message instead; this hook performs the
 * in-app navigation, acks the relay over a transferred port when one came
 * with the message, and, on mount, tells the worker the page can receive it
 * (the worker holds the tap target for windows it had to open fresh).
 */
export function useNotificationNavigation(): void {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;

    const onMessage = (event: MessageEvent) => {
      if (!isNotificationNavigateMessage(event.data)) return;
      const destination = resolveNotificationDestination(event.data.url);
      if (destination === null) return;
      event.ports[0]?.postMessage("ack");
      router.push(destination);
    };

    container.addEventListener("message", onMessage);

    let active = true;
    void container.ready.then(() => {
      if (active) {
        container.controller?.postMessage({ type: "notification-navigate-ready" });
      }
    });

    return () => {
      active = false;
      container.removeEventListener("message", onMessage);
    };
  }, [router]);
}
