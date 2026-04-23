import { Capacitor } from "@capacitor/core";

export function isNativeContactsAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

export type NativePickResult =
  | { status: "ok"; name: string; phone: string | null }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "error"; error: Error };

export async function pickNativeContact(): Promise<NativePickResult> {
  const { Contacts } = await import("@capacitor-community/contacts");

  const perm = await Contacts.checkPermissions();
  if (perm.contacts !== "granted") {
    const req = await Contacts.requestPermissions();
    if (req.contacts !== "granted") return { status: "permission_denied" };
  }

  try {
    const { contact } = await Contacts.pickContact({
      projection: { name: true, phones: true },
    });
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
