"use client";

import { motion } from "framer-motion";
import { MessageSquare, Search, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConversationShareModal } from "@/components/conversations/conversation-share-modal";
import { ConversationRow } from "@/components/conversations/conversation-row";
import { NewConversationButton } from "@/components/conversations/new-conversation-button";
import { EmptyState } from "@/components/shared/empty-state";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  matchesFilter,
  matchesQuery,
  type BalanceFilter,
  type ConversationRowData,
  conversationRow,
} from "@/lib/conversations";
import { subscribeChat } from "@/lib/sync/realtime";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";

const FILTERS: Array<{ key: BalanceFilter; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "owes", label: "A pagar" },
  { key: "owed", label: "A receber" },
  { key: "none", label: "Sem saldo" },
];

export function ConversationsListContent() {
  const me = useMe();
  const groupOrder = useAppStore((state) => state.groupOrder);
  const groups = useAppStore((state) => state.groups);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BalanceFilter>("all");

  const rows = useMemo(() => {
    if (!me) return [];
    const built: ConversationRowData[] = [];
    for (const groupId of groupOrder) {
      const snapshot = groups[groupId];
      if (!snapshot) continue;
      const row = conversationRow(snapshot, me.id);
      if (row) built.push(row);
    }
    return built;
  }, [groupOrder, groups, me]);

  const visibleRows = useMemo(
    () => rows.filter((row) => matchesQuery(query, row) && matchesFilter(filter, row.netCents)),
    [filter, query, rows],
  );
  const hasFilters = query.trim().length > 0 || filter !== "all";
  const showFilteredEmpty = rows.length > 0 && visibleRows.length === 0 && hasFilters;

  useEffect(() => {
    if (!me || groupOrder.length === 0) return undefined;
    const unsubscribes = groupOrder.map((groupId) => subscribeChat(groupId));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [groupOrder, me]);

  return (
    <div className="mx-auto max-w-lg pb-6">
      <ScreenHeader
        title="Conversas"
        action={
          me ? (
            <div className="flex items-center gap-1">
              <NewConversationButton inline />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="size-11"
                onClick={() => setShareOpen(true)}
                aria-label="Compartilhar convite"
              >
                <Share2 className="size-5" />
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome"
            aria-label="Buscar por nome"
            className="h-11 rounded-full border-border bg-card pl-9 text-[13px]"
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 border-b border-border" role="tablist">
          {FILTERS.map((option) => {
            const active = filter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(option.key)}
                className={`-mb-px flex min-h-11 items-center justify-center border-b-2 text-[12.5px] font-semibold transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3.5 px-4">
        {showFilteredEmpty ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Limpar filtros
            </Button>
          </div>
        ) : visibleRows.length > 0 ? (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="divide-y rounded-2xl border bg-card"
          >
            {visibleRows.map((row) => (
              <motion.li key={row.groupId} variants={staggerItem}>
                <ConversationRow row={row} />
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description="Conversas aparecem quando você divide contas diretamente com alguém."
          />
        )}
      </div>

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
