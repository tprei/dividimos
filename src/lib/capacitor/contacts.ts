import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export function isNativeContactsAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

export type NativePickResult =
  | { status: "ok"; name: string; phone: string | null }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "error"; error: Error };

/**
 * Backing out of the Android picker never settles the plugin's promise, so
 * the app is left waiting forever on a screen the user already closed. The
 * app returning to the foreground with no result is that cancellation.
 */
function cancelledOnResume(): { promise: Promise<"cancelled">; dispose: () => void } {
  let removeListener: (() => void) | null = null;
  let settled = false;

  const promise = new Promise<"cancelled">((resolve) => {
    void App.addListener("appStateChange", ({ isActive }) => {
      // The picker is another activity: the app goes inactive when it opens
      // and active again when it closes, result or not.
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
    let picked;
    try {
      picked = await Promise.race([
        Contacts.pickContact({ projection: { name: true, phones: true } }),
        backOut.promise,
      ]);
    } finally {
      backOut.dispose();
    }

    if (picked === "cancelled") return { status: "cancelled" };

    const contact = picked.contact;
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
