// Scanned-QR routing for group invites and profiles.
//
// A group-invite QR carries a `/join/<token>` URL and a profile QR carries a
// `/u/<handle>` URL. Hardening mirrors `claim-qr.ts`: whitespace is rejected
// verbatim and only the production origin (plus loopback outside production)
// is accepted.

import { isAcceptedAppOrigin, PRODUCTION_CLAIM_ORIGIN } from "./claim-qr";

export interface GroupInviteQrResult {
  token: string;
}

export interface ProfileQrResult {
  handle: string;
}

/** `create_invite_link` tokens are 24 random bytes, base64url, unpadded. */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** Routing guard only; `lookup_user_by_handle` is the authority on existence. */
export const PROFILE_HANDLE_RE = /^[a-z0-9._]{3,30}$/;

// ASCII + Unicode whitespace. QR payloads with any whitespace are rejected
// verbatim — never trimmed — so padding cannot smuggle extra data.
const WHITESPACE_RE = /\s/;

function parseAppUrl(data: string): URL | null {
  if (WHITESPACE_RE.test(data)) return null;

  let parsed: URL;
  try {
    parsed = new URL(data, PRODUCTION_CLAIM_ORIGIN);
  } catch {
    return null;
  }

  if (!isAcceptedAppOrigin(parsed.origin)) return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  return parsed;
}

export function parseGroupInviteQrCode(data: string): GroupInviteQrResult | null {
  const parsed = parseAppUrl(data);
  if (!parsed) return null;

  const match = parsed.pathname.match(/^\/join\/([A-Za-z0-9_-]{32})$/);
  if (!match) return null;
  return { token: match[1] };
}

export function parseProfileQrCode(data: string): ProfileQrResult | null {
  const parsed = parseAppUrl(data);
  if (!parsed) return null;

  const match = parsed.pathname.match(/^\/u\/([^/]+)$/);
  if (!match) return null;
  const handle = match[1].toLowerCase();
  if (!PROFILE_HANDLE_RE.test(handle)) return null;
  return { handle };
}
