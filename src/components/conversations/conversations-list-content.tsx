"use client";

import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import { MessageSquare, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConversationRow } from "@/components/conversations/conversation-row";
import { NewConversationButton } from "@/components/conversations/new-conversation-button";
import { EmptyState } from "@/components/shared/empty-state";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";
import { staggerItem } from "@/lib/animations";
import {
  matchesFilter,
  matchesQuery,
  type BalanceFilter,
} from "@/lib/conversations";
import { cn } from "@/lib/utils";
import { subscribeChat } from "@/lib/sync/realtime";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import { selectConversationRows } from "@/stores/app-selectors";

const FILTERS: Array<{ key: BalanceFilter; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "owes", label: "A pagar" },
  { key: "owed", label: "A receber" },
  { key: "none", label: "Em dia" },
];

const SWIPE_DISTANCE_PX = 56;
const SWIPE_VELOCITY_PX = 400;

export function swipeTarget(current: BalanceFilter, info: Pick<PanInfo, "offset" | "velocity">): BalanceFilter | null {
  const { offset, velocity } = info;
  if (Math.abs(offset.x) < Math.abs(offset.y) * 1.5) return null;
  if (Math.abs(offset.x) < SWIPE_DISTANCE_PX && Math.abs(velocity.x) < SWIPE_VELOCITY_PX) return null;
  const index = FILTERS.findIndex(({ key }) => key === current);
  const next = FILTERS[index + (offset.x < 0 ? 1 : -1)];
  return next ? next.key : null;
}

export function ConversationsListContent() {
  const me = useMe();
  const rows = useAppStore((state) => selectConversationRows(state, me?.id ?? null));
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BalanceFilter>("all");
  const [direction, setDirection] = useState<1 | -1>(1);

  const selectFilter = (next: BalanceFilter) => {
    if (next === filter) return;
    const from = FILTERS.findIndex(({ key }) => key === filter);
    const to = FILTERS.findIndex(({ key }) => key === next);
    setDirection(to > from ? 1 : -1);
    setFilter(next);
    haptics.selectionChanged();
  };

  const visibleRows = useMemo(
    () => rows.filter((row) => matchesQuery(query, row) && matchesFilter(filter, row.netCents)),
    [filter, query, rows],
  );
  const hasFilters = query.trim().length > 0 || filter !== "all";
  const showFilteredEmpty = rows.length > 0 && visibleRows.length === 0 && hasFilters;

  useEffect(() => {
    if (!me || rows.length === 0) return undefined;
    const unsubscribes = rows.map((row) => subscribeChat(row.groupId));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [me, rows]);

  return (
    <div className="mx-auto max-w-lg pb-6 md:max-w-2xl">
      <ScreenHeader
        title="Conversas"
        action={me ? <NewConversationButton inline /> : undefined}
      />
      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome"
            aria-label="Buscar por nome"
            className="pl-9"
          />
        </div>
        <div role="tablist" aria-label="Filtrar conversas por saldo" className="mt-2 flex border-b border-border">
          {FILTERS.map(({ key, label }) => {
            const active = key === filter;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectFilter(key)}
                className={cn(
                  "relative flex h-9 min-w-0 flex-1 items-center justify-center px-1 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:bg-muted [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:inset-x-0 [@media(pointer:coarse)]:after:-top-1 [@media(pointer:coarse)]:after:h-11",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {active && (
                  <motion.span
                    layoutId="conversation-filter-indicator"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <motion.div
        className="min-h-[50dvh] px-4 pt-3"
        style={{ touchAction: "pan-y" }}
        onPanEnd={(_, info) => {
          const next = swipeTarget(filter, info);
          if (next) selectFilter(next);
        }}
      >
        {showFilteredEmpty ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setQuery("");
                selectFilter("all");
              }}
            >
              Limpar filtros
            </Button>
          </div>
        ) : visibleRows.length > 0 ? (
          <motion.ul
            key={filter}
            variants={{
              hidden: { opacity: 0, x: direction * 24 },
              visible: { opacity: 1, x: 0, transition: { duration: 0.18, ease: "easeOut", staggerChildren: 0.03 } },
            }}
            initial={reduceMotion ? false : "hidden"}
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
      </motion.div>
    </div>
  );
}
