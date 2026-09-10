import { debtRowsForGroup } from "@/lib/ledger/debt-rows";
import type { GroupSnapshot, MemberStatus, UserProfile } from "@/types/ledger";

export type BalanceFilter = "all" | "owes" | "owed" | "none";

export interface ConversationRowData {
  groupId: string;
  kind: "dm" | "group";
  title: string;
  avatarName: string;
  avatarUrl: string | null;
  href: string;
  preview: string | null;
  previewIsMine: boolean;
  speaker: UserProfile | null;
  lastMessageAt: string | null;
  unreadCount: number;
  netCents: number;
  statusLine: string | null;
}

function dmInviteStatusLine(
  myStatus: MemberStatus | undefined,
  counterpartyStatus: MemberStatus,
): string | null {
  if (myStatus === "invited") return "Convite para conversar";
  if (counterpartyStatus === "invited") return "Aguardando aceitar o convite";
  return null;
}

function resolveSpeaker(
  snapshot: GroupSnapshot,
  senderId: string | undefined,
): UserProfile | null {
  if (!senderId) return null;
  return snapshot.members.find((member) => member.userId === senderId)?.user ?? null;
}

function netCentsForGroup(snapshot: GroupSnapshot, meId: string): number {
  return debtRowsForGroup(snapshot, meId).reduce(
    (sum, row) => sum + (row.direction === "owed" ? row.amountCents : -row.amountCents),
    0,
  );
}

export function conversationRow(
  snapshot: GroupSnapshot,
  meId: string,
): ConversationRowData | null {
  const netCents = netCentsForGroup(snapshot, meId);
  const isDm = snapshot.group.kind === "dm";

  if (isDm) {
    const counterparty = snapshot.members.find((member) => member.userId !== meId);
    if (!counterparty) return null;

    const myStatus = snapshot.members.find((member) => member.userId === meId)?.status;
    const statusLine = dmInviteStatusLine(myStatus, counterparty.status);
    const lastMessage = statusLine ? null : snapshot.lastMessage;

    return {
      groupId: snapshot.group.id,
      kind: "dm",
      title: counterparty.user.name,
      avatarName: counterparty.user.name,
      avatarUrl: counterparty.user.avatarUrl,
      href: `/app/conversations/${counterparty.userId}`,
      preview: lastMessage?.content ?? null,
      previewIsMine: lastMessage?.senderId === meId,
      speaker: resolveSpeaker(snapshot, lastMessage?.senderId),
      lastMessageAt: lastMessage?.createdAt ?? null,
      unreadCount: statusLine ? 0 : snapshot.unreadCount,
      netCents,
      statusLine,
    };
  }

  const myStatus = snapshot.members.find((member) => member.userId === meId)?.status;
  if (myStatus !== "accepted") return null;

  const lastMessage = snapshot.lastMessage;
  return {
    groupId: snapshot.group.id,
    kind: "group",
    title: snapshot.group.name,
    avatarName: snapshot.group.name,
    avatarUrl: null,
    href: `/app/groups/${snapshot.group.id}/chat`,
    preview: lastMessage?.content ?? "Sem mensagens",
    previewIsMine: lastMessage?.senderId === meId,
    speaker: resolveSpeaker(snapshot, lastMessage?.senderId),
    lastMessageAt: lastMessage?.createdAt ?? null,
    unreadCount: snapshot.unreadCount,
    netCents,
    statusLine: null,
  };
}

export function matchesFilter(filter: BalanceFilter, netCents: number): boolean {
  if (filter === "owes") return netCents < 0;
  if (filter === "owed") return netCents > 0;
  if (filter === "none") return netCents === 0;
  return true;
}

export function matchesQuery(query: string, row: ConversationRowData): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return row.title.toLocaleLowerCase().includes(normalizedQuery);
}
