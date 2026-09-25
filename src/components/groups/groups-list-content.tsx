"use client";

import { useRouter } from "next/navigation";
import { Bot, Plus, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { EmptyState } from "@/components/shared/empty-state";
import { InvitationCard } from "@/components/groups/invitation-card";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isBotGroup } from "@/lib/bot-group";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { createGroup } from "@/lib/sync/mutations-group";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { selectPendingInvitations } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

function netInGroup(snapshot: GroupSnapshot, meId: string): number {
  const row = snapshot.balances.find(
    (balance) => balance.kind === "user" && balance.participantId === meId
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
  const accepted = snapshot.members.filter(
    (member) => member.status === "accepted"
  );
  const netCents = netInGroup(snapshot, meId);
  const balanceLabel =
    netCents < 0 ? "a pagar" : netCents > 0 ? "a receber" : "em dia";
  const botGroup = isBotGroup(snapshot.members, meId);

  return (
    <ListRow
      href={`/app/groups/${snapshot.group.id}`}
      title={snapshot.group.name}
      subtitle={`${accepted.length + snapshot.guests.length} pessoas · ${
        snapshot.expenseCount
      } conta${snapshot.expenseCount !== 1 ? "s" : ""}`}
      leading={
        <GroupAvatar
          name={snapshot.group.name}
          avatar={snapshot.overview?.avatar}
          groupId={snapshot.group.id}
        />
      }
      meta={
        botGroup ? (
          <Bot className="size-4 text-gold" aria-label="Grupo de bots" />
        ) : undefined
      }
      trailing={
        <span className="flex flex-col items-end gap-1">
          <Money
            cents={netCents}
            size="sm"
            tone="auto"
            label={`${balanceLabel} ${formatBRL(Math.abs(netCents))}`}
          />
          <span className="text-xs text-muted-foreground">{balanceLabel}</span>
        </span>
      }
    />
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
    }))
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
    haptics.tap();
    setCreating(true);
    try {
      const ack = await createGroup(name, []);
      haptics.success();
      router.push(`/app/groups/${ack.groupId}`);
    } catch (error) {
      haptics.error();
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
        title="Grupos"
        action={
          <IconButton
            aria-label="Novo grupo"
            aria-expanded={showCreate}
            onClick={() => {
              haptics.tap();
              setShowCreate((current) => !current);
            }}
          >
            <Plus className="size-5" />
          </IconButton>
        }
      />
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-6 md:max-w-2xl">
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
          <SectionCard>
            {joined.map((snapshot) => (
              <GroupRow
                key={snapshot.group.id}
                snapshot={snapshot}
                meId={meId}
              />
            ))}
          </SectionCard>
        )}

        {joined.length === 0 && invitations.length === 0 && (
          <EmptyState
            icon={Users}
            title="Nenhum grupo ainda"
            description="As contas compartilhadas ficam juntas por aqui."
            actionLabel="Criar grupo"
            onAction={() => setShowCreate(true)}
          />
        )}
      </div>
    </>
  );
}
