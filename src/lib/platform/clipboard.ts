/**
 * The one clipboard boundary. Web and Capacitor call sites go through here
 * so a native clipboard plugin, when one is installed, lands in this file
 * alone.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the clipboard for paste affordances. Returns null when the browser
 * denies the read or offers no clipboard at all.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
