"use client";

import { motion } from "framer-motion";
import { Loader2, Receipt, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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

/**
 * The identity + query tuple one search attempt is bound to. Every async
 * continuation captures this and compares it before committing, so a result
 * from account A or a superseded query revision can never paint under account B.
 */
type AuthenticatedSearchKey = Readonly<{
  authGeneration: number;
  userId: string;
  normalizedQuery: string;
  queryRevision: number;
}>;

type SearchGenerationKey = AuthenticatedSearchKey & Readonly<{ attempt: number }>;

type SearchRequestToken = SearchGenerationKey & Readonly<{ requestId: number }>;

type SearchState =
  | { status: "idle" }
  | { status: "debouncing"; key: SearchGenerationKey }
  | { status: "loading"; token: SearchRequestToken }
  | { status: "success"; token: SearchRequestToken; results: SearchResults }
  | { status: "failure"; token: SearchRequestToken };

type SearchAction =
  | { type: "REQUEST_STARTED"; token: SearchRequestToken }
  | { type: "REQUEST_SUCCEEDED"; token: SearchRequestToken; results: SearchResults }
  | { type: "REQUEST_FAILED"; token: SearchRequestToken };

/** Monotonic, so a StrictMode double-invoke of the effect cannot cross-commit. */
let nextRequestId = 0;

function sameToken(a: SearchRequestToken, b: SearchRequestToken): boolean {
  return (
    a.authGeneration === b.authGeneration &&
    a.userId === b.userId &&
    a.normalizedQuery === b.normalizedQuery &&
    a.queryRevision === b.queryRevision &&
    a.attempt === b.attempt &&
    a.requestId === b.requestId
  );
}

function sameGenerationKey(
  a: SearchGenerationKey,
  b: SearchGenerationKey,
): boolean {
  return (
    a.authGeneration === b.authGeneration &&
    a.userId === b.userId &&
    a.normalizedQuery === b.normalizedQuery &&
    a.queryRevision === b.queryRevision &&
    a.attempt === b.attempt
  );
}

function initSearchState(props: SearchGenerationKey): SearchState {
  if (props.normalizedQuery.length < 2) return { status: "idle" };
  if (props.attempt === 0) return { status: "debouncing", key: props };
  return {
    status: "loading",
    token: { ...props, requestId: nextRequestId++ },
  };
}

function reducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "REQUEST_STARTED": {
      // From the debounce phase the held key has no requestId yet; compare the
      // five generation fields. A retry (attempt > 0) is already loading, so
      // STARTED just confirms the requestId minted in execute().
      if (
        state.status === "debouncing" &&
        sameGenerationKey(state.key, action.token)
      ) {
        return { status: "loading", token: action.token };
      }
      if (
        state.status === "loading" &&
        sameGenerationKey(state.token, action.token)
      ) {
        return { status: "loading", token: action.token };
      }
      return state;
    }
    case "REQUEST_SUCCEEDED": {
      if (state.status !== "loading") return state;
      if (!sameToken(state.token, action.token)) return state;
      return { status: "success", token: action.token, results: action.results };
    }
    case "REQUEST_FAILED": {
      if (state.status !== "loading") return state;
      if (!sameToken(state.token, action.token)) return state;
      return { status: "failure", token: action.token };
    }
  }
}

type QueryResult = { data: unknown; error: { message?: string } | null };

/**
 * Level 1. Reads the verified identity snapshot and owns the raw input. The
 * input lives here (not in the keyed child) precisely so it never remounts and
 * loses focus on every keystroke. The keyed child below is what remounts per
 * revision/identity boundary, discarding its owned state synchronously.
 */
export function SearchContent() {
  const auth = useAuth();
  const [rawQuery, setRawQuery] = useState("");
  const [queryRevision, setQueryRevision] = useState(0);

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

      {auth.status === "authenticated" && (
        <>
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
                value={rawQuery}
                onChange={(e) => {
                  setRawQuery(e.target.value);
                  // Every input event bumps the revision, including
                  // trim-equivalent ones ("ana" -> "ana "), so the keyed child
                  // remounts and aborts the in-flight request for the prior
                  // revision.
                  setQueryRevision((r) => r + 1);
                }}
                className="pl-9"
                autoFocus
              />
            </div>
          </motion.div>

          <AuthenticatedSearchBase
            key={`${auth.generation}:${auth.userId}:${queryRevision}`}
            authGeneration={auth.generation}
            userId={auth.userId}
            normalizedQuery={rawQuery.trim()}
            queryRevision={queryRevision}
          />
        </>
      )}
    </div>
  );
}

/**
 * Level 2. Owns the retry counter. Because the parent keys this component on
 * the identity + revision tuple, `attempt` is destroyed and re-initialized to 0
 * on every boundary — remounting IS the reset, so there is no effect that
 * resets it.
 */
function AuthenticatedSearchBase(props: AuthenticatedSearchKey) {
  const [attempt, setAttempt] = useState(0);
  return (
    <SearchAttempt
      key={attempt}
      {...props}
      attempt={attempt}
      onRetry={() => setAttempt((a) => a + 1)}
    />
  );
}

type SearchAttemptProps = SearchGenerationKey & Readonly<{ onRetry: () => void }>;

/**
 * Level 3. Owns the reducer, the debounce timer, and the AbortController for one
 * attempt. Keyed, so it mounts exactly once per attempt — the effect therefore
 * uses an empty dependency array.
 */
function SearchAttempt(props: SearchAttemptProps) {
  const [state, dispatch] = useReducer(reducer, props, initSearchState);

  // Capture the generation key at mount. The parent key makes any change a
  // remount, so this ref is constant for the component's life; reading it from
  // a deps-[] effect is correct and avoids a stale-closure without an
  // exhaustive-deps escape hatch.
  const owner = useRef<SearchGenerationKey>(props);

  useEffect(() => {
    const { normalizedQuery } = owner.current;
    if (normalizedQuery.length < 2) return;

    const controller = new AbortController();
    const signal = controller.signal;
    let cancelled = false;
    let timer: NodeJS.Timeout | undefined;

    const execute = async () => {
      const token: SearchRequestToken = {
        ...owner.current,
        requestId: nextRequestId++,
      };
      // For attempt 0 this promotes debouncing -> loading once the timer fires
      // (not on keystroke). For a retry it confirms the loading state already
      // seeded by the initializer.
      dispatch({ type: "REQUEST_STARTED", token });
      // Single failure protocol: cancel anything still pending and move to the
      // failure state. Every validation site calls this and returns.
      const fail = () => {
        controller.abort();
        dispatch({ type: "REQUEST_FAILED", token });
      };
      try {
        const supabase = createClient();
        const pattern = `%${normalizedQuery}%`;

        const [groupsRes, expensesRes, profilesRes, balancesRes] =
          await Promise.all<QueryResult>([
            supabase
              .from("groups")
              .select("id, name")
              .ilike("name", pattern)
              .limit(10)
              .abortSignal(signal),
            supabase
              .from("expenses")
              .select(
                "id, title, merchant_name, total_amount, status, group_id",
              )
              .or(`title.ilike.${pattern},merchant_name.ilike.${pattern}`)
              .order("created_at", { ascending: false })
              .limit(10)
              .abortSignal(signal),
            supabase
              .from("user_profiles")
              .select("id, handle, name, avatar_url")
              .or(`name.ilike.${pattern},handle.ilike.${pattern}`)
              .limit(10)
              .abortSignal(signal),
            supabase
              .from("balances")
              .select("group_id, user_a, user_b, amount_cents")
              .or(`user_a.eq.${token.userId},user_b.eq.${token.userId}`)
              .neq("amount_cents", 0)
              .abortSignal(signal),
          ]);

        if (cancelled || signal.aborted) return;

        if (
          groupsRes.error !== null ||
          !Array.isArray(groupsRes.data) ||
          expensesRes.error !== null ||
          !Array.isArray(expensesRes.data) ||
          profilesRes.error !== null ||
          !Array.isArray(profilesRes.data) ||
          balancesRes.error !== null ||
          !Array.isArray(balancesRes.data)
        ) {
          fail();
          return;
        }

        const groupsData = groupsRes.data as {
          id: string;
          name: string;
        }[];
        const expensesData = expensesRes.data as {
          id: string;
          title: string;
          merchant_name: string | null;
          total_amount: number;
          status: string;
          group_id: string;
        }[];
        const profilesData = profilesRes.data as {
          id: string | null;
          handle: string | null;
          name: string | null;
          avatar_url: string | null;
        }[];
        const balancesData = balancesRes.data as {
          group_id: string;
          user_a: string;
          user_b: string;
          amount_cents: number;
        }[];

        const groupIds = [...new Set(groupsData.map((g) => g.id))];
        const expenseGroupIds = [
          ...new Set(expensesData.map((e) => e.group_id)),
        ];

        // Secondary reads — only the applicable ones, both sharing the signal.
        const membersBuilder =
          groupIds.length > 0
            ? supabase
                .from("group_members")
                .select("group_id")
                .in("group_id", groupIds)
                .eq("status", "accepted")
                .abortSignal(signal)
            : null;
        const labelsBuilder =
          expenseGroupIds.length > 0
            ? supabase
                .from("groups")
                .select("id, name")
                .in("id", expenseGroupIds)
                .abortSignal(signal)
            : null;

        let membersData: { group_id: string }[] = [];
        let labelRows: { id: string; name: string }[] = [];
        if (membersBuilder !== null || labelsBuilder !== null) {
          const settled = await Promise.all<QueryResult | null>([
            membersBuilder,
            labelsBuilder,
          ]);
          if (cancelled || signal.aborted) return;

          const [membersResult, labelsResult] = settled;
          if (membersResult !== null) {
            if (
              membersResult.error !== null ||
              !Array.isArray(membersResult.data)
            ) {
              fail();
              return;
            }
            membersData = membersResult.data as { group_id: string }[];
          }
          if (labelsResult !== null) {
            if (
              labelsResult.error !== null ||
              !Array.isArray(labelsResult.data)
            ) {
              fail();
              return;
            }
            labelRows = labelsResult.data as { id: string; name: string }[];
          }
        }

        const groupMemberCounts = new Map<string, number>();
        for (const m of membersData) {
          groupMemberCounts.set(
            m.group_id,
            (groupMemberCounts.get(m.group_id) ?? 0) + 1,
          );
        }

        const groups: GroupResult[] = groupsData.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: (groupMemberCounts.get(g.id) ?? 0) + 1,
        }));

        // Label coverage: every requested expense group must resolve to exactly
        // one non-blank name, with no unexpected id. Replaces the old `?? ""`
        // fallback, which silently fabricated empty group names.
        const requested = new Set(expenseGroupIds);
        const labels = new Map<string, string>();
        for (const row of labelRows) {
          if (typeof row.id !== "string" || !requested.has(row.id)) {
            fail();
            return;
          }
          if (typeof row.name !== "string" || row.name.trim() === "") {
            fail();
            return;
          }
          if (labels.has(row.id)) {
            fail();
            return;
          }
          labels.set(row.id, row.name);
        }
        if (labels.size !== requested.size) {
          fail();
          return;
        }

        const expenses: ExpenseResult[] = [];
        for (const e of expensesData) {
          const groupName = labels.get(e.group_id);
          // Guaranteed defined by the coverage check above; fail closed anyway.
          if (groupName === undefined) {
            fail();
            return;
          }
          expenses.push({
            id: e.id,
            title: e.title,
            merchantName: e.merchant_name,
            totalAmount: e.total_amount,
            status: e.status as ExpenseStatus,
            groupId: e.group_id,
            groupName,
          });
        }

        const balanceByUser = new Map<
          string,
          { cents: number; direction: "owes" | "owed" }
        >();
        for (const b of balancesData) {
          const counterpartyId =
            b.user_a === token.userId ? b.user_b : b.user_a;
          const existing = balanceByUser.get(counterpartyId);
          const deltaCents = Math.abs(b.amount_cents);
          const dir =
            b.user_a === token.userId
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

        const people: PersonResult[] = profilesData.flatMap((p) => {
          if (
            p.id === null ||
            p.id === token.userId ||
            p.handle === null ||
            p.name === null
          ) {
            return [];
          }
          const bal = balanceByUser.get(p.id);
          return [
            {
              id: p.id,
              handle: p.handle,
              name: p.name,
              avatarUrl: p.avatar_url,
              balanceCents: bal?.cents ?? 0,
              balanceDirection:
                bal && bal.cents > 0 ? bal.direction : "settled",
            },
          ];
        });

        if (cancelled || signal.aborted) return;

        dispatch({
          type: "REQUEST_SUCCEEDED",
          token,
          results: { groups, expenses, people },
        });
      } catch {
        if (cancelled) return;
        fail();
      }
    };

    if (owner.current.attempt === 0) {
      timer = setTimeout(() => void execute(), DEBOUNCE_MS);
    } else {
      void execute();
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // The component is keyed on the identity + revision + attempt tuple, so it
    // mounts exactly once per attempt. owner.current is constant for that life.
  }, [owner]);

  if (state.status === "idle") return null;

  if (state.status === "debouncing" || state.status === "loading") {
    return (
      <div className="mt-6 flex justify-center" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "failure") {
    return (
      <div
        role="alert"
        className="mt-6 rounded-2xl border bg-card p-4 text-center"
      >
        <p className="text-sm text-muted-foreground">
          Não foi possível buscar agora.
        </p>
        <Button onClick={props.onRetry} className="mt-3" size="sm">
          Tentar de novo
        </Button>
      </div>
    );
  }

  const { results, token } = state;
  const totalResults =
    results.groups.length + results.expenses.length + results.people.length;

  if (totalResults === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Nenhum resultado"
        description={`Sem resultados para "${token.normalizedQuery}".`}
      />
    );
  }

  return (
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
  );
}
