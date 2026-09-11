import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { configureStatusBar } from "./status-bar";
import { isSingleUseTarget, resolveDeepLinkTarget } from "./deep-link";
import { runBackHandlers } from "./back-handler";

// SHA-256 digest of a single-use target's canonical path. Stored (never the
// credential or token itself) so a cold-start claim or invite navigates
// exactly once and a reload does not re-trigger it.
const CONSUMED_KEY = "dividimos.claim.consumed";

async function fingerprintTarget(target: string): Promise<string> {
  const data = new TextEncoder().encode(target);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function readConsumed(): string | null {
  try {
    return sessionStorage.getItem(CONSUMED_KEY);
  } catch {
    return null;
  }
}

function writeConsumed(digest: string): void {
  try {
    sessionStorage.setItem(CONSUMED_KEY, digest);
  } catch {
    // Best-effort dedup marker; navigation is unaffected if storage fails.
  }
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Wire up native (Capacitor) platform behavior. `replace` is the navigation
 * sink (defaults to a full location assignment); the PWA passes the Next
 * router's `replace` so deep links use client-side navigation.
 */
export async function initCapacitor(
  replace: (href: string) => void = (href) => {
    window.location.href = href;
  },
): Promise<void> {
  if (!isNativePlatform()) return;

  await configureStatusBar();

  App.addListener("backButton", ({ canGoBack }) => {
    if (runBackHandlers()) return;
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });

  App.addListener("appUrlOpen", ({ url }) => {
    const target = resolveDeepLinkTarget(url);
    if (!target) return;
    // A warm tap always navigates and refreshes the consumed marker.
    if (isSingleUseTarget(target)) {
      void fingerprintTarget(target).then(writeConsumed);
    }
    replace(target);
  });

  // Cold start: the app was launched from a deep link while closed. A
  // force-stopped app never sees appUrlOpen, so every resolvable target has
  // to navigate from here, not just claims.
  const launch = await App.getLaunchUrl();
  const launchTarget = launch?.url ? resolveDeepLinkTarget(launch.url) : null;
  if (launchTarget === null) return;

  if (!isSingleUseTarget(launchTarget)) {
    replace(launchTarget);
    return;
  }

  // Navigate exactly once per distinct credential-bearing target; on a later
  // init or reload the stored digest matches and we skip. Only a SHA-256
  // digest is stored, never the credential.
  const digest = await fingerprintTarget(launchTarget);
  if (readConsumed() !== digest) {
    writeConsumed(digest);
    replace(launchTarget);
  }
}
