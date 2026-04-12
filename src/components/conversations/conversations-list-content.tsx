"use client";

import { motion } from "framer-motion";
import { MessageSquare, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { getUnreadCounts } from "@/lib/supabase/unread-actions";
import { useUser } from "@/hooks/use-auth";
import type { UserProfile } from "@/types";

export interface ConversationEntry {
  groupId: string;
  counterparty: UserProfile;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  netBalanceCents: number;
  unreadCount: number;
}

interface ConversationsListContentProps {
  initialConversations: ConversationEntry[];
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
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

export function filterConversations(
  entries: ConversationEntry[],
  query: string,
): ConversationEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return entries;

  return entries.filter((conv) => {
    const name = conv.counterparty.name.toLowerCase();
    const handle = conv.counterparty.handle.toLowerCase();
    const message = (conv.lastMessageContent ?? "").toLowerCase();
    return (
      name.includes(trimmed) ||
      handle.includes(trimmed) ||
      message.includes(trimmed)
    );
  });
}

export function ConversationsListContent({
  initialConversations,
}: ConversationsListContentProps) {
  const user = useUser();
  const [conversations, setConversations] =
    useState<ConversationEntry[]>(initialConversations);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = useMemo(
    () => filterConversations(conversations, searchQuery),
    [conversations, searchQuery],
  );

  const isSearching = searchQuery.trim().length >= 2;

  const refetchRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    const handleRefresh = () => refetchRef.current?.();
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, []);

  const refetch = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: dmPairs } = await supabase
      .from("dm_pairs")
      .select("group_id, user_a, user_b")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

    if (!dmPairs || dmPairs.length === 0) {
      setConversations([]);
      return;
    }

    const counterpartyIds = dmPairs.map((p) =>
      p.user_a === user.id ? p.user_b : p.user_a,
    );
    const groupIds = dmPairs.map((p) => p.group_id);

    const [{ data: profiles }, { data: lastMessages }, { data: balanceRows }, unreadMap] =
      await Promise.all([
        supabase
          .from("user_profiles")
          .select("id, handle, name, avatar_url")
          .in("id", counterpartyIds),
        supabase
          .from("chat_messages")
          .select("group_id, content, message_type, created_at")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("balances")
          .select("group_id, user_a, user_b, amount_cents")
          .in("group_id", groupIds)
          .neq("amount_cents", 0),
        getUnreadCounts(supabase, user.id, groupIds),
      ]);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [
        p.id,
        {
          id: p.id,
          handle: p.handle,
          name: p.name,
          avatarUrl: p.avatar_url ?? undefined,
        } as UserProfile,
      ]),
    );

    const lastMessageByGroup = new Map<
      string,
      { content: string; messageType: string; createdAt: string }
    >();
    for (const msg of lastMessages ?? []) {
      if (!lastMessageByGroup.has(msg.group_id)) {
        lastMessageByGroup.set(msg.group_id, {
          content: msg.content,
          messageType: msg.message_type,
          createdAt: msg.created_at,
        });
      }
    }

    const balanceByGroup = new Map<string, number>();
    for (const b of (balanceRows as {
      group_id: string;
      user_a: string;
      user_b: string;
      amount_cents: number;
    }[]) ?? []) {
      const net =
        b.user_a === user.id ? -b.amount_cents : b.amount_cents;
      balanceByGroup.set(
        b.group_id,
        (balanceByGroup.get(b.group_id) ?? 0) + net,
      );
    }

    const entries: ConversationEntry[] = dmPairs
      .map((pair) => {
        const counterpartyId =
          pair.user_a === user.id ? pair.user_b : pair.user_a;
        const counterparty = profileMap.get(counterpartyId);
        if (!counterparty) return null;

        const lastMsg = lastMessageByGroup.get(pair.group_id);
        const lastMessageContent = lastMsg
          ? lastMsg.messageType === "text"
            ? lastMsg.content
            : lastMsg.messageType === "system_expense"
              ? "Nova conta criada"
              : "Pagamento registrado"
          : null;

        return {
          groupId: pair.group_id,
          counterparty,
          lastMessageContent,
          lastMessageAt: lastMsg?.createdAt ?? null,
          netBalanceCents: balanceByGroup.get(pair.group_id) ?? 0,
          unreadCount: unreadMap.get(pair.group_id) ?? 0,
        };
      })
      .filter((c): c is ConversationEntry => c !== null)
      .sort((a, b) => {
        const aTime = a.lastMessageAt ?? "";
        const bTime = b.lastMessageAt ?? "";
        return bTime.localeCompare(aTime);
      });

    setConversations(entries);
  }, [user]);

  useEffect(() => {
    refetchRef.current = refetch;
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold">Conversas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {conversations.length === 0
            ? "Nenhuma conversa ainda"
            : `${conversations.length} conversa${conversations.length !== 1 ? "s" : ""}`}
        </p>
      </motion.div>

      {conversations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4 }}
          className="mt-4"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, @handle ou mensagem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-4 space-y-2"
      >
        {filteredConversations.map((conv) => (
          <motion.div key={conv.groupId} variants={staggerItem}>
            <Link href={`/app/conversations/${conv.counterparty.id}`}>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                <UserAvatar
                  name={conv.counterparty.name}
                  avatarUrl={conv.counterparty.avatarUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate font-medium ${conv.unreadCount > 0 ? "text-foreground" : ""}`}>
                      {conv.counterparty.name}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {conv.lastMessageAt && (
                        <span className={`text-xs ${conv.unreadCount > 0 ? "text-primary font-medium" : "text-muted-foreground"}`}>
                          {formatRelativeTime(conv.lastMessageAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${conv.unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                      {conv.lastMessageContent ?? (
                        <span className="italic">Sem mensagens</span>
                      )}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {conv.netBalanceCents !== 0 && (
                        <span
                          className={`text-xs font-semibold ${
                            conv.netBalanceCents > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {conv.netBalanceCents > 0 ? "+" : ""}
                          {formatBRL(conv.netBalanceCents)}
                        </span>
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                          {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}

        {isSearching && filteredConversations.length === 0 && (
          <EmptyState
            icon={Search}
            title="Nenhum resultado"
            description={`Sem resultados para "${searchQuery.trim()}".`}
          />
        )}

        {!isSearching && conversations.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description="Conversas aparecem quando você divide contas diretamente com alguém."
          />
        )}
      </motion.div>
    </div>
  );
}
