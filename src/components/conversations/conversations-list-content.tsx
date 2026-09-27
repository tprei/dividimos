"use client";

import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import { Archive, ChevronRight, MessageSquare, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ConversationRow } from "@/components/conversations/conversation-row";
import { NewConversationButton } from "@/components/conversations/new-conversation-button";
import { EmptyState } from "@/components/shared/empty-state";
import { ScreenHeader } from "@/components/shared/screen-header";
import { SwipeableArchiveRow } from "@/components/shared/swipeable-archive-row";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
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
import { archiveGroup, unarchiveGroup } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import { selectConversationListSections } from "@/stores/app-selectors";

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
  const archivedView = useSearchParams().get("view") === "archived";
  const sections = useAppStore(selectConversationListSections);
  const rows = archivedView ? sections.archived : sections.active;
  const panStartedInRow = useRef(false);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BalanceFilter>("all");
  const [direction, setDirection] = useState<1 | -1>(1);

  const setArchivedView = (show: boolean) => {
    const url = new URL(window.location.href);
    if (show) {
      url.searchParams.set("view", "archived");
      window.history.pushState({ archivedConversations: true }, "", `${url.pathname}${url.search}`);
    } else if (window.history.state?.archivedConversations === true) {
      window.history.back();
    } else {
      url.searchParams.delete("view");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  };

  const changeArchive = async (groupId: string, archived: boolean) => {
    try {
      await (archived ? archiveGroup(groupId) : unarchiveGroup(groupId));
      toast.success(archived ? "Conversa arquivada" : "Conversa desarquivada");
    } catch (error) {
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    }
  };

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
        title={archivedView ? "Arquivadas" : "Conversas"}
        subtitle={archivedView ? "Conversas arquivadas" : undefined}
        back={archivedView}
        onBack={() => setArchivedView(false)}
        action={!archivedView && me ? <NewConversationButton inline /> : undefined}
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
                  "relative flex min-h-11 min-w-0 flex-1 items-center justify-center px-1 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:bg-muted",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {active && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : "conversation-filter-indicator"}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <motion.div
        className="min-h-[50dvh] space-y-3 px-4 pt-3"
        style={{ touchAction: "pan-y" }}
        onPanStart={(event) => {
          panStartedInRow.current = event.target instanceof Element && event.target.closest("[data-swipe-row]") !== null;
        }}
        onPanEnd={(_, info) => {
          if (panStartedInRow.current) return;
          const next = swipeTarget(filter, info);
          if (next) selectFilter(next);
        }}
      >
        {!archivedView && sections.archived.length > 0 && (
          <SectionCard>
            <ListRow
              title="Arquivadas"
              trailingAlign="center"
              onClick={() => setArchivedView(true)}
              leading={
                <span className="relative flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Archive className="size-5" aria-hidden="true" />
                  <UnreadBadge count={sections.archivedUnreadCount} />
                </span>
              }
              trailing={
                <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
                  {sections.archived.length}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </span>
              }
            />
          </SectionCard>
        )}
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
            className="divide-y overflow-hidden rounded-2xl border bg-card"
          >
            {visibleRows.map((row) => (
              <motion.li key={row.groupId} variants={reduceMotion ? undefined : staggerItem}>
                <SwipeableArchiveRow
                  action={row.archiveAction}
                  onArchive={() => void changeArchive(row.groupId, true)}
                  onUnarchive={() => void changeArchive(row.groupId, false)}
                >
                  <ConversationRow row={row} />
                </SwipeableArchiveRow>
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <div className="flex flex-col items-center">
            <EmptyState
              icon={archivedView ? Archive : MessageSquare}
              title={archivedView ? "Nenhuma conversa arquivada" : "Nenhuma conversa"}
              description={archivedView ? "As conversas que você arquivar ficam aqui." : "Conversas aparecem quando você divide contas diretamente com alguém."}
            />
            {!archivedView && me && <NewConversationButton inline label="Começar conversa" />}
          </div>
        )}
      </motion.div>
    </div>
  );
}
