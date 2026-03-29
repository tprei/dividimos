/**
 * Duplicate NFC-e receipt detection using localStorage.
 *
 * Stores scanned chave de acesso keys with timestamps so the app can
 * warn users before they re-enter a receipt that was already processed.
 * Keys are stored as `nfce:<chaveAcesso>` → ISO timestamp.
 */

const STORAGE_PREFIX = "nfce:";

/** Maximum age (in ms) for a stored key before it's considered expired. 30 days. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Check if an NFC-e receipt with the given chave de acesso has been
 * scanned before.
 *
 * @returns The ISO timestamp of the previous scan, or `null` if not found.
 */
export function checkDuplicateReceipt(chaveAcesso: string): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + chaveAcesso);
    if (!stored) return null;

    // Check if the entry has expired
    const scannedAt = new Date(stored).getTime();
    if (Number.isNaN(scannedAt)) return null;
    if (Date.now() - scannedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_PREFIX + chaveAcesso);
      return null;
    }

    return stored;
  } catch {
    // localStorage unavailable (SSR, private browsing, quota exceeded)
    return null;
  }
}

/**
 * Record that an NFC-e receipt has been scanned.
 * Call this after the user confirms the scanned receipt.
 */
export function markReceiptScanned(chaveAcesso: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + chaveAcesso, new Date().toISOString());
  } catch {
    // localStorage unavailable — silently ignore
  }
}

/**
 * Remove a stored receipt entry (e.g., if the user cancels after scanning).
 */
export function clearReceiptRecord(chaveAcesso: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + chaveAcesso);
  } catch {
    // localStorage unavailable — silently ignore
  }
}
