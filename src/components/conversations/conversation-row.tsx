import Link from "next/link";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { formatBRL } from "@/lib/currency";
import type { ConversationRowData } from "@/lib/conversations";

function formatConversationTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  if (isToday) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function balanceLabel(row: ConversationRowData): string {
  if (row.netCents < 0) return `você deve ${formatBRL(Math.abs(row.netCents))}`;
  if (row.netCents > 0) return `${row.kind === "dm" ? "te deve" : "te devem"} ${formatBRL(row.netCents)}`;
  return "em dia";
}

export function ConversationRow({ row }: { row: ConversationRowData }) {
  const preview = row.statusLine ?? row.preview ?? "Sem mensagens";
  const showEmptyPreview = row.statusLine === null && (row.preview === null || row.preview === "Sem mensagens");
  const unreadLabel = `${row.unreadCount} mensagens não lidas`;

  return (
    <Link
      href={row.href}
      aria-label={`${row.title}, ${balanceLabel(row)}, ${row.unreadCount} não lidas`}
      data-testid={`conversation-row-${row.kind}`}
      className="flex min-h-16 min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring motion-safe:active:scale-[0.98]"
    >
      {row.kind === "group" ? (
        <GroupAvatar name={row.avatarName} groupId={row.groupId} />
      ) : (
        <UserAvatar name={row.avatarName} avatarUrl={row.avatarUrl} size="md" isBot={row.avatarIsBot} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span title={row.title} className="min-w-0 flex-1 truncate text-base font-semibold">{row.title}</span>
          {row.lastMessageAt && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatConversationTime(row.lastMessageAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-sm text-muted-foreground ${showEmptyPreview ? "italic" : ""}`}
          >
            {row.kind === "dm" && row.previewIsMine && row.statusLine === null && "Você: "}
            {row.kind === "group" && row.speaker && `${row.previewIsMine ? "Você" : row.speaker.name.split(" ")[0]}: `}
            {preview}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {row.netCents !== 0 && <Money cents={row.netCents} signed size="sm" tone={row.netCents > 0 ? "positive" : "negative"} />}
        {row.unreadCount > 0 && (
          <span
            aria-label={unreadLabel}
            data-testid="unread-badge"
            className="flex size-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-2xs font-bold text-primary-foreground"
          >
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
          </span>
        )}
      </span>
    </Link>
  );
}
