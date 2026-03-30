const CLAIM_PATH_RE = /\/claim\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

export interface ClaimQrResult {
  token: string;
  url: string;
}

export function parseClaimQrCode(data: string): ClaimQrResult | null {
  const trimmed = data.trim();
  const match = trimmed.match(CLAIM_PATH_RE);
  if (!match) return null;
  return { token: match[1], url: trimmed };
}
