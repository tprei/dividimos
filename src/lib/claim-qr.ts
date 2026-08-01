// Guest-claim credential transport (issue #472).
//
// The claim credential never travels in a URL path, query, header, or OAuth
// state — only in the URL fragment (`/claim#gst1_...`), which browsers do not
// send to the server. This module is the single source of truth for building
// and parsing those URLs. The token rule is duplicated only where the runtime
// can't import this module (the native deep-link resolver); both copies must
// stay identical to CLAIM_TOKEN_RE below.

export const PRODUCTION_CLAIM_ORIGIN = "https://www.dividimos.ai";

export interface ClaimQrResult {
  token: string;
  url: string;
}

/** Exact credential shape: `gst1_` + 43 base64url chars (48 bytes total). */
export const CLAIM_TOKEN_RE = /^gst1_[A-Za-z0-9_-]{43}$/;

// ASCII + Unicode whitespace. QR payloads with any whitespace are rejected
// verbatim — never trimmed — so a trailing padding/whitespace attack cannot
// smuggle extra data past the fragment check.
const WHITESPACE_RE = /\s/;

const LOOPBACK_ORIGIN_RE =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

function isAcceptedOrigin(origin: string): boolean {
  if (origin === PRODUCTION_CLAIM_ORIGIN) return true;
  if (process.env.NODE_ENV === "production") return false;
  return LOOPBACK_ORIGIN_RE.test(origin);
}

/**
 * Build the canonical claim URL for a guest. In production this is always the
 * public origin; in dev it is the current window origin so a local server is
 * reachable. The credential lives only in the fragment.
 */
export function buildClaimUrl(token: string): string {
  const origin =
    process.env.NODE_ENV === "production"
      ? PRODUCTION_CLAIM_ORIGIN
      : window.location.origin;
  return `${origin}/claim#${token}`;
}

/**
 * Parse a scanned/read claim URL. Accepts only the production origin (plus
 * loopback in non-production) with pathname exactly `/claim`, empty search,
 * and a fragment that is exactly a `gst1_...` credential. Relative inputs
 * starting with `/` resolve against the production origin. Returns the
 * credential and the local `/claim#<token>` path, or `null` for anything else.
 */
export function parseClaimQrCode(data: string): ClaimQrResult | null {
  // Reject before any URL parsing if the raw input carries whitespace.
  if (WHITESPACE_RE.test(data)) return null;

  let parsed: URL;
  try {
    parsed = new URL(data, PRODUCTION_CLAIM_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.pathname !== "/claim") return null;
  if (parsed.search !== "") return null;
  if (!parsed.hash.startsWith("#")) return null;

  const token = parsed.hash.slice(1);
  if (!CLAIM_TOKEN_RE.test(token)) return null;
  if (!isAcceptedOrigin(parsed.origin)) return null;

  return { token, url: `/claim#${token}` };
}
