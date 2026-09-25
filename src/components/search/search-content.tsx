"use client";

import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { ListRow } from "@/components/ui/list-row";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/shared/money";
import { Receipt, Search, Users, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, UserProfile } from "@/types/ledger";

export function SearchContent() {
  const [query, setQuery] = useState("");
  const [remoteResult, setRemoteResult] = useState<{
    query: string;
    user: UserProfile | null;
    failed: boolean;
  } | null>(null);

  const groups = useAppStore((state) => state.groups);
  const groupOrder = useAppStore((state) => state.groupOrder);
  const expenses = useAppStore((state) => state.expenses);
  const meId = useAppStore((state) => state.me?.id ?? null);

  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();
  const q = trimmed.toLowerCase();

  const typedTrimmed = query.trim();
  const typedQ = typedTrimmed.toLowerCase();
  const handleQuery = typedQ.startsWith("@") ? typedQ.slice(1) : typedQ;
  const isHandleQuery =
    (typedQ.startsWith("@") && handleQuery.length >= 3) ||
    /^[a-z0-9_]{3,30}$/.test(typedQ);
  const current = isHandleQuery && remoteResult?.query === typedQ ? remoteResult : null;
  const remoteUser = current && !current.failed ? current.user : null;
  const remoteFailed = current?.failed ?? false;

  useEffect(() => {
    if (!isHandleQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const user = await lookupUserByHandle(handleQuery);
        if (!controller.signal.aborted) setRemoteResult({ query: typedQ, user, failed: false });
      } catch {
        if (!controller.signal.aborted) setRemoteResult({ query: typedQ, user: null, failed: true });
      }
    }, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [typedQ, handleQuery, isHandleQuery]);

  const matchedGroups = useMemo(() => {
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
        if (m.userId === meId || seen.has(m.userId)) continue;
        seen.add(m.userId);
        const nameMatch = m.user.name.toLowerCase().includes(q);
        const handleMatch = m.user.handle.toLowerCase().includes(q);
        if (nameMatch || handleMatch) {
          list.push(m.user);
        }
      }
    }
    return list;
  }, [groups, meId, q]);

  const matchedPeople = useMemo(() => {
    if (!q) return [];
    const result = [...localMembers];
    if (remoteUser && remoteUser.id !== meId && !result.some((u) => u.id === remoteUser.id)) {
      result.push(remoteUser);
    }
    return result;
  }, [localMembers, remoteUser, meId, q]);

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
    <div className="mx-auto max-w-lg px-4 py-6 md:max-w-2xl">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Buscar grupos, contas ou pessoas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar grupos, contas, pessoas..."
          autoFocus
          className="h-12 rounded-2xl bg-card pl-10 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <IconButton
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {!trimmed && matchedGroups.length === 0 ? (
        <p className="mt-12 text-center text-sm text-muted-foreground">Grupos, contas ou @usuário</p>
      ) : !hasResults ? (
        <div className="mt-12 text-center">
          {remoteFailed ? (
            <>
              <p role="status" className="sr-only">Busca indisponível</p>
              <p className="text-sm font-semibold text-foreground">
                Não foi possível buscar esse @handle
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Verifique sua conexão e tente de novo.
              </p>
            </>
          ) : (
            isHandleQuery && !current ? <p role="status" className="text-sm text-muted-foreground">Buscando pessoa...</p> : <>
              <p className="text-sm font-semibold text-foreground">
                Nada encontrado
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {matchedGroups.length > 0 && (
            <div>
              <h2 className="text-lg font-bold">
                {trimmed ? "Grupos" : "Grupos recentes"}
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card divide-y">
                {matchedGroups.slice(0, trimmed ? undefined : 5).map((group) => (
                  <ListRow key={group.id} href={`/app/groups/${group.id}`} title={group.name} subtitle={`${group.memberCount} ${group.memberCount === 1 ? "membro" : "membros"}`} leading={<Users className="size-5 text-primary" />} />
                ))}
              </div>
            </div>
          )}

          {matchedPeople.length > 0 && (
            <div>
              <h2 className="text-lg font-bold">
                Pessoas
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card divide-y">
                {matchedPeople.map((person) => (
                  <ListRow key={person.id} href={`/app/conversations/${person.id}`} title={person.name} subtitle={`@${person.handle}`} leading={<UserAvatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} size="sm" isBot={person.isBot} />} />
                ))}
              </div>
            </div>
          )}

          {matchedExpenses.length > 0 && (
            <div>
              <h2 className="text-lg font-bold">
                Contas
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card divide-y">
                {matchedExpenses.map((exp) => (
                  <ListRow key={exp.id} href={`/app/bill/${exp.id}`} title={exp.title} subtitle={exp.merchantName ? `${exp.merchantName} · ${exp.groupName}` : exp.groupName} leading={<Receipt className="size-5 text-muted-foreground" />} trailing={<Money cents={exp.totalCents} className="text-sm font-semibold" />} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
