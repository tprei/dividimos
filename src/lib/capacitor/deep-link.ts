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
    return safeRedirect(parsed.pathname + parsed.search + parsed.hash, "/app");
  }

  if (parsed.protocol === "https:" && parsed.host === ALLOWED_HTTPS_HOST) {
    return safeRedirect(parsed.pathname + parsed.search + parsed.hash, "/app");
  }

  return null;
}
