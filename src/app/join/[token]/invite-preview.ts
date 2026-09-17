export interface InvitePreview {
  groupName: string | null;
  memberCount: number | null;
  creatorName: string | null;
  valid: boolean;
}

// `preview_invite_link` returns the same shape for every invalid case (unknown, inactive,
// expired, exhausted) with no reason code, so the page can only render one generic message.
export const INVALID_INVITE_MESSAGE = "Este convite não é mais válido.";

export function parseInvitePreview(raw: unknown): InvitePreview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const groupName = typeof record.groupName === "string" ? record.groupName : null;
  const memberCount = typeof record.memberCount === "number" ? record.memberCount : null;
  const creatorName = typeof record.creatorName === "string" ? record.creatorName : null;
  const valid = record.valid === true;
  return { groupName, memberCount, creatorName, valid };
}
