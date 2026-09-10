import Link from "next/link";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
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
  return "sem saldo";
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
      className="flex min-h-16 min-w-0 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
    >
      <UserAvatar name={row.avatarName} avatarUrl={row.avatarUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{row.title}</span>
          {row.lastMessageAt && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatConversationTime(row.lastMessageAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {row.kind === "group" && row.speaker && (
            <UserAvatar
              name={row.speaker.name}
              avatarUrl={row.speaker.avatarUrl}
              size="xs"
              className="h-[18px] w-[18px] flex-none text-[8px]"
            />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] text-muted-foreground ${showEmptyPreview ? "italic" : ""}`}
          >
            {row.kind === "dm" && row.previewIsMine && row.statusLine === null && "Você: "}
            {preview}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {row.netCents !== 0 && <Money cents={row.netCents} signed className="text-[11.5px]" />}
        {row.unreadCount > 0 && (
          <span
            aria-label={unreadLabel}
            data-testid="unread-badge"
            className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-[5px] text-[9.5px] font-extrabold text-primary-foreground"
          >
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
          </span>
        )}
      </span>
    </Link>
  );
}
