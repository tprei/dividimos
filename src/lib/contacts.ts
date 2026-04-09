/**
 * Web Contact Picker API utility.
 *
 * Uses the Contact Picker API (supported on Android Chrome 80+)
 * to let users select contacts and extract phone numbers for
 * WhatsApp invites.
 *
 * @see https://developer.chrome.com/docs/capabilities/web-apis/contact-picker
 */

interface ContactInfo {
  name: string[];
  tel: string[];
}

/** Whether the browser supports the Contact Picker API. */
export function isContactPickerSupported(): boolean {
  return "contacts" in navigator && "ContactsManager" in window;
}

/**
 * Opens the native contact picker and returns selected contacts
 * with their phone numbers.
 *
 * Returns `null` if the user cancels or the API is unavailable.
 */
export async function pickContacts(): Promise<
  { name: string; phone: string }[] | null
> {
  if (!isContactPickerSupported()) return null;

  try {
    // eslint-disable-next-line -- vendor API not in TS lib types
    const contacts: ContactInfo[] = await (navigator as any).contacts.select(
      ["name", "tel"],
      { multiple: true },
    );

    if (!contacts || contacts.length === 0) return null;

    return contacts
      .filter((c) => c.tel && c.tel.length > 0)
      .map((c) => ({
        name: c.name?.[0] ?? "",
        phone: normalizeBrazilianPhone(c.tel[0]),
      }));
  } catch {
    // User cancelled or permission denied
    return null;
  }
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
