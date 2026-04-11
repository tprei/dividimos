"use client";

import { motion } from "framer-motion";
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Receipt,
  UserPlus,
} from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import { fetchActivityFeed } from "@/lib/supabase/activity-actions";
import type { ActivityItem, ActivityType } from "@/types";

type FilterType = "all" | ActivityType;

const filters: { key: FilterType; label: string }[] = [
  { key: "all", label: "Tudo" },
  { key: "expense_activated", label: "Despesas" },
  { key: "settlement_recorded", label: "Pagamentos" },
  { key: "member_joined", label: "Membros" },
];

const typeConfig: Record<
  ActivityType,
  { icon: typeof Receipt; color: string; bg: string }
> = {
  expense_activated: {
    icon: Receipt,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  settlement_recorded: {
    icon: ArrowRightLeft,
    color: "text-warning-foreground",
    bg: "bg-warning/15",
  },
  settlement_confirmed: {
    icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/15",
  },
  member_joined: {
    icon: UserPlus,
    color: "text-info",
    bg: "bg-info/15",
  },
};

function formatRelativeDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function describeItem(item: ActivityItem, userId: string): string {
  switch (item.type) {
    case "expense_activated": {
      const isActor = item.actorId === userId;
      const who = isActor ? "Você criou" : `${item.actor.name} criou`;
      return `${who} "${item.expenseTitle}" · ${formatBRL(item.totalAmount)}`;
    }
    case "settlement_recorded": {
      const isFrom = item.actorId === userId;
      if (isFrom) {
        return `Você registrou pagamento de ${formatBRL(item.amountCents)} para ${item.toUser.name}`;
      }
      return `${item.actor.name} registrou pagamento de ${formatBRL(item.amountCents)} para ${item.toUser.name}`;
    }
    case "settlement_confirmed": {
      const isConfirmer = item.actorId === userId;
      if (isConfirmer) {
        return `Você confirmou pagamento de ${formatBRL(item.amountCents)} de ${item.fromUser.name}`;
      }
      return `${item.actor.name} confirmou pagamento de ${formatBRL(item.amountCents)} de ${item.fromUser.name}`;
    }
    case "member_joined":
      return `${item.actor.name} entrou no grupo`;
  }
}

interface ActivityContentProps {
  initialItems: ActivityItem[];
  userId: string;
}

export function ActivityContent({
  initialItems,
  userId,
}: ActivityContentProps) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<FilterType>("all");
  const [isPending, startTransition] = useTransition();
  const [hasMore, setHasMore] = useState(initialItems.length >= 30);

  const handleRefresh = useCallback(() => {
    startTransition(async () => {
      const fresh = await fetchActivityFeed({ userId, limit: 30 });
      setItems(fresh);
      setHasMore(fresh.length >= 30);
    });
  }, [userId]);

  const handleLoadMore = useCallback(() => {
    if (items.length === 0) return;
    const lastTimestamp = items[items.length - 1].timestamp;
    startTransition(async () => {
      const older = await fetchActivityFeed({
        userId,
        limit: 30,
        before: lastTimestamp,
      });
      if (older.length < 30) setHasMore(false);
      setItems((prev) => [...prev, ...older]);
    });
  }, [userId, items]);

  const filtered =
    filter === "all"
      ? items
      : filter === "settlement_recorded"
        ? items.filter(
            (i) =>
              i.type === "settlement_recorded" ||
              i.type === "settlement_confirmed",
          )
        : items.filter((i) => i.type === filter);

  return (
    <div className="px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Atividade</h1>
        <button
          onClick={handleRefresh}
          disabled={isPending}
          className="text-sm font-medium text-primary disabled:opacity-50"
        >
          {isPending ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nenhuma atividade"
          description="Quando houver despesas, pagamentos ou novos membros nos seus grupos, aparece aqui"
        />
      ) : (
        <>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            key={filter}
            className="space-y-2"
          >
            {filtered.map((item) => (
              <ActivityCard
                key={item.id}
                item={item}
                userId={userId}
              />
            ))}
          </motion.div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isPending}
                className="text-sm font-medium text-primary disabled:opacity-50"
              >
                {isPending ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityCard({
  item,
  userId,
}: {
  item: ActivityItem;
  userId: string;
}) {
  const config = typeConfig[item.type];
  const Icon = config.icon;

  return (
    <motion.div
      variants={staggerItem}
      className="flex items-start gap-3 rounded-xl bg-card p-3"
    >
      <UserAvatar
        name={item.actor.name}
        avatarUrl={item.actor.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{describeItem(item, userId)}</p>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.bg} ${config.color}`}
          >
            <Icon className="h-3 w-3" />
            {item.groupName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeDate(item.timestamp)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
