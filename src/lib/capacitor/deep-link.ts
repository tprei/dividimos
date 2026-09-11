import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseJoinQrCode } from "@/lib/join-qr";
import { safeRedirect } from "@/lib/safe-redirect";

const ALLOWED_HTTPS_HOST = "www.dividimos.ai";

/**
 * Canonical `dividimos://` authorities and the route prefix each one opens.
 *
 * The authority is part of the destination, not decoration: dropping it sent
 * `dividimos://app/groups/<id>` to `/groups/<id>`, a route that does not
 * exist. Signed-in screens live under `/app`; `join` is a public route of its
 * own. Any other authority is not a destination this app serves.
 */
const SCHEME_AUTHORITIES: Record<string, string> = {
  app: "/app",
  join: "/join",
};

export function resolveDeepLinkTarget(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === "dividimos:") {
    // Claim credentials travel only via the HTTPS fragment route. The custom
    // scheme's authority is not a pathname, so dividimos://claim#... is rejected.
    if (parsed.host === "claim") return null;

    const prefix = SCHEME_AUTHORITIES[parsed.host];
    if (prefix === undefined) return null;

    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return safeRedirect(`${prefix}${path}${parsed.search}${parsed.hash}`, "/app");
  }

  if (parsed.protocol === "https:" && parsed.host === ALLOWED_HTTPS_HOST) {
    if (parsed.pathname === "/claim" || parsed.pathname.startsWith("/claim/")) {
      const claim = parseClaimQrCode(url);
      return claim ? claim.url : null;
    }
    if (parsed.pathname.startsWith("/join")) {
      // A malformed invite link is not a destination; it would land on a
      // join page with a token the server will reject anyway.
      const join = parseJoinQrCode(url);
      return join ? join.url : null;
    }
    return safeRedirect(parsed.pathname + parsed.search + parsed.hash, "/app");
  }

  return null;
}

/** Does this target carry a credential that must be consumed exactly once? */
export function isSingleUseTarget(target: string): boolean {
  return target.startsWith("/claim#") || target.startsWith("/join/");
}
