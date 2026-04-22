/**
 * Web Contact Picker API utility.
 *
 * Uses the Contact Picker API (supported on Android Chrome 80+)
 * to let users select contacts and extract phone numbers for
 * WhatsApp invites.
 *
 * The API is NOT available in Capacitor WebViews, iOS Safari, desktop
 * browsers, or non-secure contexts. Callers should hide the picker
 * button when `isContactPickerSupported()` returns false.
 *
 * @see https://developer.chrome.com/docs/capabilities/web-apis/contact-picker
 */

import { Capacitor } from "@capacitor/core";

interface ContactInfo {
  name: string[];
  tel: string[];
}

type NavigatorWithContacts = Navigator & {
  contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<ContactInfo[]> };
};

export type PickContactsResult =
  | { status: "ok"; contacts: { name: string; phone: string }[] }
  | { status: "cancelled" }
  | { status: "unsupported" }
  | { status: "error"; error: Error };

/** Whether the browser supports the Contact Picker API. */
export function isContactPickerSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  // Capacitor WebViews expose `navigator.contacts` via Cordova shims but
  // the Web Contact Picker API is not implemented there. Force-disable to
  // avoid silent no-ops inside the native apps.
  if (Capacitor.isNativePlatform()) return false;
  const nav = navigator as NavigatorWithContacts;
  return (
    "contacts" in navigator &&
    "ContactsManager" in window &&
    typeof nav.contacts?.select === "function"
  );
}

/**
 * Opens the native contact picker and returns the outcome as a
 * discriminated union so callers can surface meaningful feedback.
 */
export async function pickContacts(): Promise<PickContactsResult> {
  if (!isContactPickerSupported()) return { status: "unsupported" };

  const nav = navigator as NavigatorWithContacts;
  let contacts: ContactInfo[];
  try {
    contacts = await nav.contacts!.select(["name", "tel"], { multiple: true });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // The spec rejects with an AbortError when the user dismisses the
    // chooser; treat that as a cancellation, not a failure.
    if (error.name === "AbortError") return { status: "cancelled" };
    return { status: "error", error };
  }

  if (!contacts || contacts.length === 0) return { status: "cancelled" };

  const selected = contacts
    .filter((c) => c.tel && c.tel.length > 0)
    .map((c) => ({
      name: c.name?.[0] ?? "",
      phone: normalizeBrazilianPhone(c.tel[0]),
    }));

  return { status: "ok", contacts: selected };
}

/**
 * Normalises a Brazilian phone number to E.164-ish format
 * suitable for wa.me links (digits only, with country code).
 *
 * Examples:
 *   "(11) 99999-8888"  → "5511999998888"
 *   "+55 11 99999-8888" → "5511999998888"
 *   "11999998888"       → "5511999998888"
 */
function normalizeBrazilianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  // Already has country code
  if (digits.startsWith("55") && digits.length >= 12) return digits;

  // Local number with area code (10-11 digits)
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;

  // Fallback: return as-is (might be international)
  return digits;
}

/**
 * Builds a WhatsApp deep link for a specific phone number.
 * If no phone is provided, opens WhatsApp's contact chooser.
 */
export function buildWhatsAppLink(message: string, phone?: string): string {
  const encoded = encodeURIComponent(message);
  if (phone) {
    return `https://wa.me/${phone}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}
