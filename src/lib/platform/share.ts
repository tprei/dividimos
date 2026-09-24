/**
 * The one share boundary. Web and Capacitor call sites go through here so a
 * native share plugin, when one is installed, lands in this file alone.
 * "dismissed" is the user closing the share sheet, not a failure.
 */
export type ShareOutcome = "shared" | "dismissed" | "unsupported";

export function isShareSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  );
}

export async function shareLink(input: {
  title?: string;
  text?: string;
  url: string;
}): Promise<ShareOutcome> {
  if (!isShareSupported()) return "unsupported";
  try {
    await navigator.share(input);
    return "shared";
  } catch (error) {
    // InvalidStateError means a share sheet is already open from an earlier
    // tap; falling back to copy would consume the gesture a second time.
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "InvalidStateError")
    ) {
      return "dismissed";
    }
    return "unsupported";
  }
}
