"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Receipt, Search, Users, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";

export function SearchContent() {
  const [query, setQuery] = useState("");
  const [remoteResult, setRemoteResult] = useState<{ query: string; user: UserProfile | null } | null>(null);

  const groups = useAppStore((state) => state.groups);
  const groupOrder = useAppStore((state) => state.groupOrder);
  const expenses = useAppStore((state) => state.expenses);
  const me = useAppStore((state) => state.me);

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();

  const handleQuery = q.startsWith("@") ? q.slice(1) : q;
  const isHandleQuery =
    (q.startsWith("@") && handleQuery.length >= 3) || /^[a-z0-9_]{3,30}$/.test(q);
  const remoteUser = isHandleQuery && remoteResult?.query === q ? remoteResult.user : null;

  useEffect(() => {
    if (!isHandleQuery) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const user = await lookupUserByHandle(handleQuery);
        if (!cancelled) setRemoteResult({ query: q, user });
      } catch {
        if (!cancelled) setRemoteResult({ query: q, user: null });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, handleQuery, isHandleQuery]);

  const matchedGroups = useMemo(() => {
    if (!q) return [];
    return groupOrder
      .map((id) => groups[id])
      .filter((s): s is GroupSnapshot => Boolean(s))
      .filter(
        (s) =>
          s.group.kind === "group" &&
          s.group.name.toLowerCase().includes(q),
      )
      .map((s) => ({
        id: s.group.id,
        name: s.group.name,
        memberCount: s.members.length,
      }));
  }, [groups, groupOrder, q]);

  const localMembers = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const list: UserProfile[] = [];
    for (const snapshot of Object.values(groups)) {
      for (const m of snapshot.members) {
        if (m.userId === me?.id || seen.has(m.userId)) continue;
        seen.add(m.userId);
        const nameMatch = m.user.name.toLowerCase().includes(q);
        const handleMatch = m.user.handle.toLowerCase().includes(q);
        if (nameMatch || handleMatch) {
          list.push(m.user);
        }
      }
    }
    return list;
  }, [groups, me?.id, q]);

  const matchedPeople = useMemo(() => {
    if (!q) return [];
    const result = [...localMembers];
    if (
      remoteUser &&
      remoteUser.id !== me?.id &&
      !result.some((u) => u.id === remoteUser.id)
    ) {
      result.push(remoteUser);
    }
    return result;
  }, [localMembers, remoteUser, me?.id, q]);

  const matchedExpenses = useMemo(() => {
    if (!q) return [];
    return Object.values(expenses)
      .filter((exp) => {
        const titleMatch = exp.title.toLowerCase().includes(q);
        const merchantMatch =
          exp.merchantName?.toLowerCase().includes(q) ?? false;
        return titleMatch || merchantMatch;
      })
      .map((exp) => ({
        id: exp.id,
        title: exp.title,
        merchantName: exp.merchantName,
        totalCents: exp.totalCents,
        groupName: groups[exp.groupId]?.group.name ?? "",
      }));
  }, [expenses, groups, q]);

  const hasResults =
    matchedGroups.length > 0 ||
    matchedPeople.length > 0 ||
    matchedExpenses.length > 0;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar grupos, contas, pessoas..."
          autoFocus
          className="w-full rounded-2xl border bg-muted/40 py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!trimmed ? (
        <div className="mt-12 flex flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
            <Search className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Digite para buscar grupos, contas ou pessoas
          </p>
        </div>
      ) : !hasResults ? (
        <div className="mt-12 text-center">
          <p className="text-sm font-semibold text-foreground">
            Nenhum resultado encontrado
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Não encontramos nada para &quot;{query}&quot;
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {matchedGroups.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Grupos
              </h2>
              <div className="mt-2 space-y-2">
                {matchedGroups.map((group) => (
                  <Link
                    key={group.id}
                    href={`/app/groups/${group.id}`}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-foreground">
                        {group.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.memberCount} membro
                        {group.memberCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {matchedPeople.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pessoas
              </h2>
              <div className="mt-2 space-y-2">
                {matchedPeople.map((person) => (
                  <Link
                    key={person.id}
                    href={`/app/conversations/${person.id}`}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                  >
                    <UserAvatar
                      name={person.name}
                      avatarUrl={person.avatarUrl}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-foreground">
                        {person.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        @{person.handle}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {matchedExpenses.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contas
              </h2>
              <div className="mt-2 space-y-2">
                {matchedExpenses.map((exp) => (
                  <Link
                    key={exp.id}
                    href={`/app/bill/${exp.id}`}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Receipt className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-foreground">
                        {exp.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {exp.merchantName
                          ? `${exp.merchantName} • ${exp.groupName}`
                          : exp.groupName}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {formatBRL(exp.totalCents)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
