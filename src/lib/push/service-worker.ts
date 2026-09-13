import { PushFailure } from "./failures";

/**
 * Single owner of the /sw.js registration.
 *
 * `navigator.serviceWorker.ready` never rejects and never settles when
 * activation fails, so nothing that waits on it directly can report a
 * problem. Registration is performed once here, its outcome is kept, and
 * every consumer awaits it under a deadline.
 */
const READY_TIMEOUT_MS = 8000;

let registration: Promise<ServiceWorkerRegistration> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (registration !== null) return registration;

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    registration = Promise.reject(new PushFailure("unsupported"));
    // A rejected promise nobody awaits yet must not warn.
    void registration.catch(() => {});
    return registration;
  }

  registration = navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .catch((cause: unknown) => {
      // Let the next attempt re-register rather than caching the failure
      // for the life of the tab.
      registration = null;
      throw new PushFailure("worker", cause);
    });

  return registration;
}

/**
 * The active registration, or a `worker` failure. Bounded so a service worker
 * that never activates surfaces an error instead of a spinner.
 */
export async function serviceWorkerReady(
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PushFailure("worker")), timeoutMs);
  });

  try {
    return await Promise.race([registerServiceWorker(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: forget the memoized registration. */
export function __resetServiceWorkerForTests(): void {
  registration = null;
}
