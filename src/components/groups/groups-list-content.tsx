"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Archive, Bot, ChevronRight, Plus, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
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
import { GroupsSkeleton } from "@/components/groups/groups-skeleton";
import { SwipeableArchiveRow } from "@/components/shared/swipeable-archive-row";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isBotGroup } from "@/lib/bot-group";
import { formatBRL } from "@/lib/currency";
import { groupArchiveAction, myGroupNetCents } from "@/lib/group-lifecycle";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { archiveGroup, createGroup, unarchiveGroup } from "@/lib/sync/mutations-group";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { selectGroupListSections, selectPendingInvitations } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot } from "@/types/ledger";

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
  const netCents = myGroupNetCents(snapshot, meId);
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

function GroupListRow({
  snapshot,
  meId,
  onArchive,
  onUnarchive,
}: {
  snapshot: GroupSnapshot;
  meId: string;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const action = groupArchiveAction(snapshot, meId);
  return (
    <SwipeableArchiveRow action={action} onArchive={onArchive} onUnarchive={onUnarchive}>
      <GroupRow snapshot={snapshot} meId={meId} />
    </SwipeableArchiveRow>
  );
}

export function GroupsListContent() {
  const router = useRouter();
  const archivedView = useSearchParams().get("view") === "archived";
  const sections = useAppStore(selectGroupListSections);
  const { hydrated, meId } = useAppStore(
    useShallow((state) => ({
      hydrated: state.hydrated,
      meId: state.me?.id ?? null,
    }))
  );
  const invitations = useAppStore(selectPendingInvitations);
  const { accept, decline, pendingGroupId } = useInvitationActions();
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const joined = archivedView ? sections.archived : sections.active;

  const setArchivedView = (show: boolean) => {
    const url = new URL(window.location.href);
    if (show) {
      url.searchParams.set("view", "archived");
      window.history.pushState({ archivedGroups: true }, "", `${url.pathname}${url.search}`);
    } else if (window.history.state?.archivedGroups === true) {
      window.history.back();
    } else {
      url.searchParams.delete("view");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  };

  const changeArchive = async (groupId: string, archived: boolean) => {
    try {
      await (archived ? archiveGroup(groupId) : unarchiveGroup(groupId));
      toast.success(archived ? "Grupo arquivado" : "Grupo desarquivado");
    } catch (error) {
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    }
  };

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
    return <GroupsSkeleton />;
  }

  return (
    <>
      <ScreenHeader
        title={archivedView ? "Arquivadas" : "Grupos"}
        subtitle={archivedView ? "Grupos arquivados" : undefined}
        back={archivedView}
        onBack={() => setArchivedView(false)}
        action={!archivedView &&
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
        {!archivedView && sections.archived.length > 0 && (
          <SectionCard>
            <ListRow
              title="Arquivadas"
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
        {!archivedView && showCreate && (
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

        {!archivedView && meId !== null && invitations.length > 0 && (
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
              <GroupListRow
                key={snapshot.group.id}
                snapshot={snapshot}
                meId={meId}
                onArchive={() => void changeArchive(snapshot.group.id, true)}
                onUnarchive={() => void changeArchive(snapshot.group.id, false)}
              />
            ))}
          </SectionCard>
        )}

        {joined.length === 0 && (archivedView || invitations.length === 0) && (
          <EmptyState
            icon={archivedView ? Archive : Users}
            title={archivedView ? "Nenhum grupo arquivado" : "Nenhum grupo ainda"}
            description={archivedView ? "Os grupos que você arquivar ficam aqui." : "As contas compartilhadas ficam juntas por aqui."}
            actionLabel={archivedView ? "Voltar aos grupos" : "Criar grupo"}
            onAction={() => archivedView ? setArchivedView(false) : setShowCreate(true)}
          />
        )}
      </div>
    </>
  );
}
