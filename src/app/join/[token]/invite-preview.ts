export type InviteInvalidReason = "expired" | "deactivated" | "exhausted" | "invalid";

export interface InvitePreview {
  groupName: string | null;
  memberCount: number | null;
  creatorName: string | null;
  valid: boolean;
  reason?: string | null;
}

export function parseInvitePreview(raw: unknown): InvitePreview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const groupName = typeof record.groupName === "string" ? record.groupName : null;
  const memberCount = typeof record.memberCount === "number" ? record.memberCount : null;
  const creatorName = typeof record.creatorName === "string" ? record.creatorName : null;
  const valid = record.valid === true;
  const reason = typeof record.reason === "string" ? record.reason : null;
  return { groupName, memberCount, creatorName, valid, reason };
}

export function inviteReasonKind(preview: InvitePreview): InviteInvalidReason {
  const reason = (preview.reason ?? "").toLowerCase();
  if (reason.includes("expir")) return "expired";
  if (reason.includes("deactiv") || reason.includes("inactiv")) return "deactivated";
  if (reason.includes("exhaust") || reason.includes("limit") || reason.includes("uses")) {
    return "exhausted";
  }
  return "invalid";
}

export function inviteInvalidMessage(kind: InviteInvalidReason): string {
  switch (kind) {
    case "expired":
      return "Este convite expirou.";
    case "deactivated":
      return "Este convite foi desativado.";
    case "exhausted":
      return "Este convite atingiu o limite de usos.";
    case "invalid":
      return "Este convite não é mais válido.";
  }
}
