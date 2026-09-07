"use client";

import { motion } from "framer-motion";
import { MessageSquare, Share2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConversationShareModal } from "@/components/conversations/conversation-share-modal";
import { NewConversationButton } from "@/components/conversations/new-conversation-button";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return new Date(isoDate).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

interface ConversationRow {
  groupId: string;
  kind: "dm" | "group";
  title: string;
  avatarName: string;
  avatarUrl: string | null;
  href: string;
  preview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

function toRow(snapshot: GroupSnapshot, meId: string): ConversationRow | null {
  const isDm = snapshot.group.kind === "dm";
  if (!isDm && !snapshot.lastMessage) return null;

  if (isDm) {
    const counterparty = snapshot.members.find((m) => m.userId !== meId);
    if (!counterparty) return null;
    return {
      groupId: snapshot.group.id,
      kind: "dm",
      title: counterparty.user.name,
      avatarName: counterparty.user.name,
      avatarUrl: counterparty.user.avatarUrl,
      href: `/app/conversations/${counterparty.userId}`,
      preview: snapshot.lastMessage?.content ?? null,
      lastMessageAt: snapshot.lastMessage?.createdAt ?? null,
      unreadCount: snapshot.unreadCount,
    };
  }

  return {
    groupId: snapshot.group.id,
    kind: "group",
    title: snapshot.group.name,
    avatarName: snapshot.group.name,
    avatarUrl: null,
    href: `/app/groups/${snapshot.group.id}`,
    preview: snapshot.lastMessage?.content ?? null,
    lastMessageAt: snapshot.lastMessage?.createdAt ?? null,
    unreadCount: snapshot.unreadCount,
  };
}

export function ConversationsListContent() {
  const me = useMe();
  const groupOrder = useAppStore((s) => s.groupOrder);
  const groups = useAppStore((s) => s.groups);
  const [shareOpen, setShareOpen] = useState(false);

  const rows = useMemo(() => {
    if (!me) return [];
    const built: ConversationRow[] = [];
    for (const groupId of groupOrder) {
      const snapshot = groups[groupId];
      if (!snapshot) continue;
      const row = toRow(snapshot, me.id);
      if (row) built.push(row);
    }
    return built;
  }, [me, groupOrder, groups]);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold">Conversas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma conversa ainda"
              : `${rows.length} conversa${rows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {me && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Compartilhar convite"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-4 space-y-2"
      >
        {rows.map((row) => (
          <motion.div key={row.groupId} variants={staggerItem}>
            <Link href={row.href} data-testid={`conversation-row-${row.kind}`}>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                <UserAvatar name={row.avatarName} avatarUrl={row.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`truncate font-medium ${row.unreadCount > 0 ? "text-foreground" : ""}`}
                    >
                      {row.title}
                    </p>
                    {row.lastMessageAt && (
                      <span
                        className={`shrink-0 text-xs ${
                          row.unreadCount > 0
                            ? "font-medium text-primary"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatRelativeTime(row.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p
                      className={`truncate text-sm ${
                        row.unreadCount > 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {row.preview ?? <span className="italic">Sem mensagens</span>}
                    </p>
                    {row.unreadCount > 0 && (
                      <span
                        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground"
                        data-testid="unread-badge"
                      >
                        {row.unreadCount > 99 ? "99+" : row.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}

        {rows.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description="Conversas aparecem quando você divide contas diretamente com alguém."
          />
        )}
      </motion.div>

      <NewConversationButton />

      {me && (
        <ConversationShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          handle={me.handle}
        />
      )}
    </div>
  );
}
