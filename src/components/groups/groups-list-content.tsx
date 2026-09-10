"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { EmptyState } from "@/components/shared/empty-state";
import { InvitationCard } from "@/components/groups/invitation-card";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { createGroup } from "@/lib/sync/mutations-group";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { selectPendingInvitations } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

function netInGroup(snapshot: GroupSnapshot, meId: string): number {
  const row = snapshot.balances.find(
    (balance) => balance.kind === "user" && balance.participantId === meId,
  );
  return row?.netCents ?? 0;
}

function GroupRow({
  snapshot,
  meId,
}: {
  snapshot: GroupSnapshot;
  meId: string;
}) {
  const accepted = snapshot.members.filter((member) => member.status === "accepted");
  const netCents = netInGroup(snapshot, meId);
  const balanceLabel = netCents < 0 ? "A pagar" : "A receber";
  const balanceDescription =
    netCents === 0 ? "Em dia" : `${balanceLabel} ${formatBRL(Math.abs(netCents))}`;
  const people = accepted.map((member) => ({
    id: member.userId,
    name: member.user.name,
    avatarUrl: member.user.avatarUrl,
  }));

  return (
    <Link
      href={`/app/groups/${snapshot.group.id}`}
      aria-label={`${snapshot.group.name}, ${accepted.length} membros, ${snapshot.expenseCount} contas, ${balanceDescription}`}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{snapshot.group.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {accepted.length} membros · {snapshot.expenseCount} contas
        </p>
        <div className="mt-1.5">
          <AvatarStack people={people} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        {netCents !== 0 && (
          <Money
            cents={netCents}
            signed
            className="text-sm"
            label={`${balanceLabel} ${formatBRL(Math.abs(netCents))}`}
          />
        )}
        <span className="text-[11px] text-muted-foreground">
          {netCents === 0 ? "Em dia" : balanceLabel}
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export function GroupsListContent() {
  const router = useRouter();
  const { hydrated, groupOrder, groups, meId } = useAppStore(
    useShallow((state) => ({
      hydrated: state.hydrated,
      groupOrder: state.groupOrder,
      groups: state.groups,
      meId: state.me?.id ?? null,
    })),
  );
  const invitations = useAppStore(selectPendingInvitations);
  const { accept, decline, pendingGroupId } = useInvitationActions();
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const joined = useMemo(() => {
    const snapshots: GroupSnapshot[] = [];
    if (meId === null) return snapshots;
    for (const groupId of groupOrder) {
      const snapshot = groups[groupId];
      if (!snapshot || snapshot.group.kind !== "group") continue;
      const member = snapshot.members.find((item) => item.userId === meId);
      if (member?.status === "accepted") snapshots.push(snapshot);
    }
    return snapshots;
  }, [groupOrder, groups, meId]);

  const handleCreateGroup = async (): Promise<void> => {
    const name = newGroupName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const ack = await createGroup(name, []);
      router.push(`/app/groups/${ack.groupId}`);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-6">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="rounded-2xl border bg-card">
            <GroupRowSkeleton />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <ScreenHeader
        eyebrow="Suas divisões"
        title="Grupos"
        action={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="min-h-11 min-w-11"
            aria-label="Novo grupo"
            aria-expanded={showCreate}
            onClick={() => setShowCreate((current) => !current)}
          >
            <Plus className="size-5" />
          </Button>
        }
      />
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-4">
        {showCreate && (
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Novo grupo</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="min-h-11 min-w-11"
                aria-label="Fechar criação de grupo"
                onClick={() => setShowCreate(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <Input
              className="mt-3 min-h-11"
              placeholder="Nome do grupo"
              aria-label="Nome do grupo"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreateGroup();
              }}
            />
            <Button
              type="button"
              className="mt-3 min-h-11 w-full"
              onClick={() => void handleCreateGroup()}
              disabled={!newGroupName.trim() || creating}
            >
              Criar grupo
            </Button>
          </div>
        )}

        {meId !== null && invitations.length > 0 && (
          <div className="space-y-2">
            {invitations.map((snapshot) => (
              <InvitationCard
                key={snapshot.group.id}
                snapshot={snapshot}
                meId={meId}
                busy={pendingGroupId === snapshot.group.id}
                onAccept={() => void accept(snapshot.group.id)}
                onDecline={() => void decline(snapshot.group.id)}
              />
            ))}
          </div>
        )}

        {meId !== null && joined.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
            {joined.map((snapshot) => (
              <GroupRow key={snapshot.group.id} snapshot={snapshot} meId={meId} />
            ))}
          </div>
        )}

        {joined.length === 0 && invitations.length === 0 && (
          <EmptyState
            icon={Users}
            title="Nenhum grupo ainda"
            description="Grupos juntam a galera pra dividir contas. Cria um e convida seus amigos pelo @handle."
            actionLabel="Criar grupo"
            onAction={() => setShowCreate(true)}
          />
        )}
      </div>
    </>
  );
}
