import { parseClaimQrCode } from "@/lib/claim-qr";
import { safeRedirect } from "@/lib/safe-redirect";

const ALLOWED_HTTPS_HOST = "www.dividimos.ai";

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
    return safeRedirect(parsed.pathname + parsed.search + parsed.hash, "/app");
  }

  if (parsed.protocol === "https:" && parsed.host === ALLOWED_HTTPS_HOST) {
    if (parsed.pathname === "/claim" || parsed.pathname.startsWith("/claim/")) {
      const claim = parseClaimQrCode(url);
      return claim ? claim.url : null;
    }
    return safeRedirect(parsed.pathname + parsed.search + parsed.hash, "/app");
  }

  return null;
}
