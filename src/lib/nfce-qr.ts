/**
 * NFC-e (Nota Fiscal de Consumidor Eletrônica) QR code URL parser.
 *
 * NFC-e QR codes encode a URL pointing to a SEFAZ consultation page.
 * The URL contains a query parameter `chNFe` (or the key embedded in the path)
 * which is the 44-digit access key (chave de acesso) that uniquely identifies
 * the receipt.
 *
 * Common URL patterns per state:
 *   - ?chNFe=<44 digits>
 *   - ?p=<44 digits>|...  (pipe-delimited, key is first segment)
 *   - Path segment containing 44 consecutive digits
 */

/** Result of parsing an NFC-e QR code URL */
export interface NfceQrResult {
  /** The 44-digit access key (chave de acesso) */
  chaveAcesso: string;
  /** The full URL from the QR code */
  url: string;
}

/**
 * Regex matching exactly 44 consecutive digits — the format of a
 * chave de acesso (NFC-e access key).
 */
const CHAVE_REGEX = /\d{44}/;

/**
 * Known SEFAZ domain fragments that appear in NFC-e consultation URLs.
 * Used to validate that a scanned QR code is actually an NFC-e.
 */
const SEFAZ_HINTS = [
  "nfce",
  "nfc-e",
  "sefaz",
  "fazenda",
  "sat.sef",
  "nfe.svrs",
  "dfe-portal",
];

/**
 * Check whether a URL looks like it belongs to a SEFAZ NFC-e portal.
 */
function isSefazUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SEFAZ_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Try to extract the 44-digit chave de acesso from a URL's query parameters.
 * Handles both `chNFe=<key>` and pipe-delimited `p=<key>|...` formats.
 */
function extractFromQuery(url: URL): string | null {
  // Direct chNFe parameter (most common)
  const chNFe = url.searchParams.get("chNFe");
  if (chNFe) {
    const match = chNFe.match(CHAVE_REGEX);
    if (match) return match[0];
  }

  // Pipe-delimited `p` parameter (used by some states like SP)
  const p = url.searchParams.get("p");
  if (p) {
    const firstSegment = p.split("|")[0];
    const match = firstSegment.match(CHAVE_REGEX);
    if (match) return match[0];
  }

  // Fallback: search all query parameter values
  for (const value of url.searchParams.values()) {
    const match = value.match(CHAVE_REGEX);
    if (match) return match[0];
  }

  return null;
}

/**
 * Try to extract the 44-digit chave de acesso from the URL path.
 * Some states embed the key directly in the path segments.
 */
function extractFromPath(url: URL): string | null {
  const match = url.pathname.match(CHAVE_REGEX);
  return match ? match[0] : null;
}

/**
 * Parse an NFC-e QR code URL and extract the chave de acesso.
 *
 * @param rawData - The raw string decoded from a QR code
 * @returns The parsed result, or `null` if the data is not a valid NFC-e QR code
 */
export function parseNfceQrCode(rawData: string): NfceQrResult | null {
  const trimmed = rawData.trim();

  // Must be a URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Must be HTTP(S)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  // Try query params first, then path
  const chave = extractFromQuery(url) ?? extractFromPath(url);
  if (!chave) return null;

  // Validate it's a SEFAZ URL or at least contains a valid key
  // We're lenient here — if we found a 44-digit key in a URL, it's likely NFC-e
  if (!isSefazUrl(trimmed) && !url.searchParams.has("chNFe")) {
    // Extra validation: check the full URL string for the key
    // to avoid false positives on random URLs with 44-digit numbers
    const fullMatch = trimmed.match(CHAVE_REGEX);
    if (!fullMatch) return null;
  }

  return { chaveAcesso: chave, url: trimmed };
}

/**
 * Validate a chave de acesso using its check digit (mod 11).
 * The last digit is a verification digit calculated from the first 43.
 */
export function validateChaveAcesso(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;

  const digits = chave.split("").map(Number);
  const checkDigit = digits[43];

  // Weighted sum with weights cycling 2-9 from right to left
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += digits[i] * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;

  return checkDigit === expected;
}
