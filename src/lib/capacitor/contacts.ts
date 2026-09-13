import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export function isNativeContactsAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * The Android plugin never settles `pickContact` when the chooser is dismissed, so a dismissal is
 * indistinguishable from a very slow pick. Long enough that a real pick is never misreported.
 */
const PICK_TIMEOUT_MS = 120_000;
const PICK_TIMED_OUT = Symbol("pick_timed_out");

export type NativePickResult =
  | { status: "ok"; name: string; phone: string | null }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "error"; error: Error };

function cancelledOnResume(): { promise: Promise<"cancelled">; dispose: () => void } {
  let removeListener: (() => void) | null = null;
  let settled = false;

  const promise = new Promise<"cancelled">((resolve) => {
    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !settled) resolve("cancelled");
    }).then((handle) => {
      if (settled) {
        void handle.remove();
        return;
      }
      removeListener = () => {
        void handle.remove();
      };
    });
  });

  return {
    promise,
    dispose: () => {
      settled = true;
      removeListener?.();
    },
  };
}

export async function pickNativeContact(): Promise<NativePickResult> {
  try {
    const { Contacts } = await import("@capacitor-community/contacts");

    const perm = await Contacts.checkPermissions();
    if (perm.contacts !== "granted") {
      const req = await Contacts.requestPermissions();
      if (req.contacts !== "granted") return { status: "permission_denied" };
    }

    const backOut = cancelledOnResume();
    const { promise: timeout, resolve: onTimeout } =
      Promise.withResolvers<typeof PICK_TIMED_OUT>();
    const timer = setTimeout(() => onTimeout(PICK_TIMED_OUT), PICK_TIMEOUT_MS);

    let picked;
    try {
      picked = await Promise.race([
        Contacts.pickContact({ projection: { name: true, phones: true } }),
        backOut.promise,
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      backOut.dispose();
    }

    if (picked === "cancelled" || picked === PICK_TIMED_OUT) {
      return { status: "cancelled" };
    }

    const { contact } = picked;
    if (!contact) return { status: "cancelled" };

    const phone = contact.phones?.find((p) => p.number)?.number ?? null;
    const display = contact.name?.display;
    const composed = [contact.name?.given, contact.name?.family]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    const name = display ?? composed;

    return { status: "ok", name, phone };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (/cancel/i.test(error.message)) return { status: "cancelled" };
    return { status: "error", error };
  }
}
