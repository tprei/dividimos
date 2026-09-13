// Group-invite link transport.
//
// The invite modal advertises `<origin>/join/<token>` as a QR payload, so the
// scanners must recognize exactly that shape and nothing else. This module is
// the single source of truth for reading those links, mirroring the origin
// and shape discipline `claim-qr.ts` applies to guest credentials.

import { PRODUCTION_CLAIM_ORIGIN } from "./claim-qr";

export interface JoinQrResult {
  token: string;
  url: string;
}

/** Invite tokens are 32-character base64url values minted by the invite RPC. */
export const JOIN_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

const WHITESPACE_RE = /\s/;

const LOOPBACK_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

function isAcceptedOrigin(origin: string): boolean {
  if (origin === PRODUCTION_CLAIM_ORIGIN) return true;
  if (process.env.NODE_ENV === "production") return false;
  return LOOPBACK_ORIGIN_RE.test(origin);
}

/**
 * Parse a scanned invite link.
 *
 * Accepts only the production origin (plus loopback outside production) with
 * pathname exactly `/join/<token>`, no query and no fragment. Relative inputs
 * starting with `/` resolve against the production origin.
 *
 * @returns The invite token and the local `/join/<token>` path, or `null`.
 */
export function parseJoinQrCode(data: string): JoinQrResult | null {
  if (WHITESPACE_RE.test(data)) return null;

  let parsed: URL;
  try {
    parsed = new URL(data, PRODUCTION_CLAIM_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.search !== "" || parsed.hash !== "") return null;
  if (!isAcceptedOrigin(parsed.origin)) return null;

  const segments = parsed.pathname.split("/");
  if (segments.length !== 3 || segments[1] !== "join") return null;

  const token = segments[2];
  if (!JOIN_TOKEN_RE.test(token)) return null;

  return { token, url: `/join/${token}` };
}
