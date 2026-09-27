"use client";

import type { UserProfile } from "@/types/ledger";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";

export interface BlockedUsersSectionProps {
  users: readonly UserProfile[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  busyUserId: string | null;
  onRetry: () => void;
  onUnblock: (user: UserProfile, anchor: HTMLElement) => void;
}

export function BlockedUsersSection({ users, status, error, busyUserId, onRetry, onUnblock }: BlockedUsersSectionProps): React.JSX.Element {
  const loading = status === "idle" || status === "loading";
  return (
    <section className="mt-6" aria-labelledby="blocked-users-heading">
      <h2 id="blocked-users-heading" className="mb-3 text-lg font-bold">Pessoas bloqueadas</h2>
      <div className="overflow-hidden rounded-2xl border bg-card" aria-busy={loading}>
        {loading && <div role="status" className="space-y-3 p-4"><p className="text-sm text-muted-foreground">Carregando pessoas bloqueadas...</p>{users.length === 0 && <div className="flex items-center gap-3"><Skeleton className="size-11 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-24" /></div></div>}</div>}
        {status === "error" && <div className="space-y-3 p-4"><div role="alert" className="space-y-1 text-sm text-destructive-text"><p>Não deu para carregar as pessoas bloqueadas.</p>{error && <p>{error}</p>}</div><Button variant="outline" size="lg" className="w-full" onClick={onRetry}>Tentar novamente</Button></div>}
        {status === "ready" && users.length === 0 && <p className="p-4 text-sm text-muted-foreground">Você não bloqueou ninguém.</p>}
        {users.length > 0 && <ul className="divide-y">{users.map((user) => <li key={user.id} className="flex flex-wrap items-center gap-3 p-4">
          <UserAvatar id={user.id} name={user.name} avatarUrl={user.avatarUrl} />
          <div className="min-w-0 flex-1 basis-24"><p className="truncate text-sm font-semibold" title={user.name}>{user.name}</p><p className="truncate text-sm text-muted-foreground" title={`@${user.handle}`}>@{user.handle}</p></div>
          <Button variant="outline" className="min-h-11" disabled={loading || busyUserId !== null} aria-label={`Desbloquear @${user.handle}`} onClick={(event) => onUnblock(user, event.currentTarget)}>{busyUserId === user.id ? "Desbloqueando..." : "Desbloquear"}</Button>
        </li>)}</ul>}
      </div>
    </section>
  );
}
