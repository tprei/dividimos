"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import type { ExpenseStatus } from "@/types";

interface GroupResult {
  id: string;
  name: string;
  memberCount: number;
}

interface ExpenseResult {
  id: string;
  title: string;
  merchantName: string | null;
  totalAmount: number;
  status: ExpenseStatus;
  groupId: string;
  groupName: string;
}

interface PersonResult {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  balanceCents: number;
  balanceDirection: "owes" | "owed" | "settled";
}

interface SearchResults {
  groups: GroupResult[];
  expenses: ExpenseResult[];
  people: PersonResult[];
}

const DEBOUNCE_MS = 300;

const statusConfig: Record<ExpenseStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  settled: { label: "Quitada", color: "bg-success/15 text-success" },
};

interface SearchContentProps {
  userId: string;
}

export function SearchContent({ userId }: SearchContentProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController>(undefined);

  const search = useCallback(
    async (term: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const trimmed = term.trim();
      if (trimmed.length < 2) {
        setResults(null);
        setSearched(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      const supabase = createClient();
      const pattern = `%${trimmed}%`;

      try {
        const [groupsRes, expensesRes, peopleRes, balancesRes] =
          await Promise.all([
            supabase
              .from("groups")
              .select("id, name")
              .ilike("name", pattern)
              .limit(10),
            supabase
              .from("expenses")
              .select("id, title, merchant_name, total_amount, status, group_id")
              .or(`title.ilike.${pattern},merchant_name.ilike.${pattern}`)
              .order("created_at", { ascending: false })
              .limit(10),
            supabase
              .from("user_profiles")
              .select("id, handle, name, avatar_url")
              .or(`name.ilike.${pattern},handle.ilike.${pattern}`)
              .limit(10),
            supabase
              .from("balances")
              .select("group_id, user_a, user_b, amount_cents")
              .or(`user_a.eq.${userId},user_b.eq.${userId}`)
              .neq("amount_cents", 0),
          ]);

        if (controller.signal.aborted) return;

        const groupMemberCounts = new Map<string, number>();
        const groupIds = (groupsRes.data ?? []).map((g) => g.id);
        if (groupIds.length > 0) {
          const { data: members } = await supabase
            .from("group_members")
            .select("group_id")
            .in("group_id", groupIds)
            .eq("status", "accepted");

          if (controller.signal.aborted) return;

          for (const m of members ?? []) {
            groupMemberCounts.set(
              m.group_id,
              (groupMemberCounts.get(m.group_id) ?? 0) + 1
            );
          }
        }

        const groups: GroupResult[] = (groupsRes.data ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: (groupMemberCounts.get(g.id) ?? 0) + 1,
        }));

        const expenseGroupIds = [
          ...new Set(
            (expensesRes.data ?? []).map((e) => e.group_id).filter(Boolean)
          ),
        ];
        const groupNameMap = new Map<string, string>();
        if (expenseGroupIds.length > 0) {
          const { data: gNames } = await supabase
            .from("groups")
            .select("id, name")
            .in("id", expenseGroupIds);

          if (controller.signal.aborted) return;

          for (const g of gNames ?? []) {
            groupNameMap.set(g.id, g.name);
          }
        }

        const expenses: ExpenseResult[] = (expensesRes.data ?? []).map((e) => ({
          id: e.id,
          title: e.title,
          merchantName: e.merchant_name,
          totalAmount: e.total_amount,
          status: e.status as ExpenseStatus,
          groupId: e.group_id,
          groupName: groupNameMap.get(e.group_id) ?? "",
        }));

        const balanceByUser = new Map<
          string,
          { cents: number; direction: "owes" | "owed" }
        >();
        for (const b of balancesRes.data ?? []) {
          const counterpartyId =
            b.user_a === userId ? b.user_b : b.user_a;
          const existing = balanceByUser.get(counterpartyId);
          const deltaCents = Math.abs(b.amount_cents);
          const dir =
            b.user_a === userId
              ? b.amount_cents > 0
                ? "owes"
                : "owed"
              : b.amount_cents > 0
                ? "owed"
                : "owes";

          if (existing) {
            if (existing.direction === dir) {
              existing.cents += deltaCents;
            } else {
              const net = existing.cents - deltaCents;
              if (net > 0) {
                existing.cents = net;
              } else if (net < 0) {
                existing.cents = Math.abs(net);
                existing.direction = dir;
              } else {
                existing.cents = 0;
                existing.direction = "owes";
              }
            }
          } else {
            balanceByUser.set(counterpartyId, {
              cents: deltaCents,
              direction: dir,
            });
          }
        }

        const people: PersonResult[] = (peopleRes.data ?? [])
          .filter((p) => p.id !== userId)
          .map((p) => {
            const bal = balanceByUser.get(p.id);
            return {
              id: p.id,
              handle: p.handle,
              name: p.name,
              avatarUrl: p.avatar_url,
              balanceCents: bal?.cents ?? 0,
              balanceDirection:
                bal && bal.cents > 0 ? bal.direction : "settled",
            };
          });

        if (controller.signal.aborted) return;

        setResults({ groups, expenses, people });
        setSearched(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [userId]
  );

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [query, search]);

  const totalResults =
    (results?.groups.length ?? 0) +
    (results?.expenses.length ?? 0) +
    (results?.people.length ?? 0);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-bold">Busca</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Encontre grupos, contas e pessoas
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="mt-5"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar grupos, contas, pessoas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </motion.div>

      {searched && !loading && totalResults === 0 && (
        <EmptyState
          icon={Search}
          title="Nenhum resultado"
          description={`Sem resultados para "${query.trim()}".`}
        />
      )}

      {results && totalResults > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mt-6 space-y-6"
        >
          {results.groups.length > 0 && (
            <motion.section variants={staggerItem}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Users className="h-4 w-4" />
                Grupos
              </h2>
              <div className="space-y-2">
                {results.groups.map((group) => (
                  <Link key={group.id} href={`/app/groups/${group.id}`}>
                    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Users className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{group.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {group.memberCount} membro
                          {group.memberCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.section>
          )}

          {results.expenses.length > 0 && (
            <motion.section variants={staggerItem}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Receipt className="h-4 w-4" />
                Contas
              </h2>
              <div className="space-y-2">
                {results.expenses.map((expense) => {
                  const status = statusConfig[expense.status];
                  return (
                    <Link
                      key={expense.id}
                      href={`/app/bill/${expense.id}`}
                    >
                      <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                          <Receipt className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {expense.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {expense.groupName}
                            {expense.merchantName &&
                              ` · ${expense.merchantName}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">
                            {formatBRL(expense.totalAmount)}
                          </p>
                          <span
                            className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}
                          >
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </motion.section>
          )}

          {results.people.length > 0 && (
            <motion.section variants={staggerItem}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Users className="h-4 w-4" />
                Pessoas
              </h2>
              <div className="space-y-2">
                {results.people.map((person) => (
                  <div
                    key={person.id}
                    className="flex items-center gap-4 rounded-2xl border bg-card p-4"
                  >
                    <UserAvatar
                      name={person.name}
                      avatarUrl={person.avatarUrl ?? undefined}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{person.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        @{person.handle}
                      </p>
                    </div>
                    {person.balanceDirection !== "settled" && (
                      <div className="text-right">
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            person.balanceDirection === "owes"
                              ? "text-destructive"
                              : "text-success"
                          }`}
                        >
                          {person.balanceDirection === "owes"
                            ? `Você deve ${formatBRL(person.balanceCents)}`
                            : `Te devem ${formatBRL(person.balanceCents)}`}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.section>
          )}
        </motion.div>
      )}
    </div>
  );
}
