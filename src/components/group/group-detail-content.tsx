"use client";

import { AnimatePresence } from "framer-motion";
import { Bot, MessageSquare, Share2, UserPlus, Users, UsersRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { GroupSpendingSection } from "@/components/group/group-spending-section";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { GroupExpensesSection } from "@/components/group/group-expenses-section";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { InviteByHandlePanel } from "@/components/group/group-invite-panel";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupSettlementView } from "@/components/group/group-settlement-view";
import { NotificationPrompt } from "@/components/pwa/notification-prompt";
import { EmptyState } from "@/components/shared/empty-state";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePrefetchRoutes } from "@/hooks/use-prefetch-routes";
import { isBotGroup } from "@/lib/bot-group";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { groupReadKey, IDLE_READ, useAppStore } from "@/stores/app-store";

const UNAVAILABLE_CODES: Record<string, true> = {
  not_a_member: true,
  group_not_found: true,
};

const TABS: Record<string, true> = { saldos: true, contas: true, membros: true };

export function GroupDetailContent({ groupId }: { groupId: string }) {
  const router = useRouter();
  const requestedTab = useSearchParams().get("tab");
  const { accept, decline, pendingGroupId } = useInvitationActions();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const hydrated = useAppStore((s) => s.hydrated);
  const meId = useAppStore((s) => s.me?.id ?? null);
  const snapshot = useAppStore((s) => s.groups[groupId]);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState(requestedTab !== null && TABS[requestedTab] ? requestedTab : "saldos");
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const departedRef = useRef(false);

  usePrefetchRoutes(useMemo(() => [`/app/bill/new?groupId=${groupId}`], [groupId]));

  const read = useAppStore((s) => s.reads[groupReadKey(groupId)] ?? IDLE_READ);

  const load = useCallback(() => {
    refreshGroup(groupId).catch((e: unknown) => {
      if (e instanceof LedgerError && UNAVAILABLE_CODES[e.code]) {
        // The group really is gone or we are no longer a member.
        setLoadError(true);
        return;
      }
      // Otherwise the read failed; only warn over data already on screen.
      if (useAppStore.getState().groups[groupId] !== undefined) {
        toast.error(ledgerErrorMessage(e));
      }
    });
  }, [groupId]);

  useEffect(() => {
    if (!hydrated || snapshot || loadError || departedRef.current) return;
    // Only an unattempted read may start one. A completed read without a
    // snapshot means the group is gone; refetching would loop forever.
    if (read.status !== "idle") return;
    load();
  }, [hydrated, snapshot, loadError, read.status, load]);

  const readPending = read.status === "idle" || read.status === "loading";
  if (!hydrated || (!snapshot && !loadError && readPending)) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border bg-card">
            <GroupRowSkeleton />
          </div>
        ))}
      </div>
    );
  }

  // A failed read must not claim the group was deleted.
  if (!snapshot && !loadError && read.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(read.code))}
          onRetry={load}
        />
      </div>
    );
  }

  if (loadError || !snapshot) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <EmptyState
          icon={UsersRound}
          title="Esse grupo não está mais disponível"
          description="Você não é mais membro deste grupo ou ele foi excluído."
          actionLabel="Voltar para grupos"
          onAction={() => router.replace("/app/groups")}
        />
      </div>
    );
  }

  const members = snapshot.members;
  const myMember = members.find((m) => m.userId === meId);
  const isPending = myMember?.status === "invited";
  const inviter = members.find(
    (m) => m.userId === (myMember?.invitedBy ?? snapshot.group.creatorId),
  );
  const inviterName = inviter?.user.name ?? "Alguém";
  const groupAvatar = (
    <GroupAvatar
      name={snapshot.group.name}
      avatar={snapshot.overview?.avatar}
      groupId={groupId}
      size="sm"
    />
  );

  if (isPending) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-lg flex-col px-4 py-6">
        <ScreenHeader
          back
          leading={groupAvatar}
          title={snapshot.group.name}
          onBack={() => router.push("/app/groups")}
        />
        <div className="my-auto">
        <div className="mt-5 rounded-2xl gradient-primary p-5 text-gradient-foreground shadow-lg shadow-primary/20">
          <p className="text-sm text-gradient-foreground/80">Convite para o grupo</p>
          <p className="mt-2 text-2xl font-bold">{snapshot.group.name}</p>
          <div className="mt-3 flex gap-4 text-sm text-gradient-foreground/80">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              Convite de {inviterName}
            </span>
          </div>
        </div>
        <div className="mt-3 rounded-2xl border bg-card p-4 text-sm">
          {inviterName} convidou você para este grupo. Aceite para participar da conversa e dos acertos.
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1 rounded-lg"
            onClick={() => setConfirmDecline(true)}
          >
            Recusar
          </Button>
          <Button
            className="min-h-11 flex-1 rounded-lg"
            disabled={pendingGroupId === groupId}
            onClick={() => {
              void accept(groupId);
            }}
          >
            Aceitar
          </Button>
        </div>
        </div>

        <Dialog
          open={confirmDecline}
          onOpenChange={(open) => {
            if (!open) setConfirmDecline(false);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Recusar convite?</DialogTitle>
              <DialogDescription>
                Você precisará de um novo convite para voltar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setConfirmDecline(false)}
                disabled={isDeclining}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="min-h-11"
                onClick={async () => {
                  setIsDeclining(true);
                  try {
                    const declined = await decline(groupId);
                    if (declined) router.replace("/app/groups");
                  } finally {
                    setIsDeclining(false);
                  }
                }}
                disabled={isDeclining}
              >
                {isDeclining ? "Recusando…" : "Recusar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const accepted = members.filter((m) => m.status === "accepted");
  const isCreator = meId === snapshot.group.creatorId;
  const isAcceptedMember = accepted.some((m) => m.userId === meId);
  const canInvite = meId !== null && (isCreator || isAcceptedMember);
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <ScreenHeader
        back
        leading={
          <Link
            href={`/app/groups/${groupId}/info`}
            aria-label="Ver perfil do grupo"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {groupAvatar}
          </Link>
        }
        subtitle={tab === "saldos" ? "Acerto" : `${accepted.length} membro${accepted.length !== 1 ? "s" : ""}`}
        title={snapshot.group.name}
        onBack={() => router.push("/app/groups")}
        onTitleClick={() => router.push(`/app/groups/${groupId}/info`)}
        titleClickLabel="Ver perfil do grupo"
        titleBadge={
          isBotGroup(members, meId ?? "") ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold">
              <Bot className="size-3.5" aria-hidden="true" />
              Grupo de bots
            </span>
          ) : null
        }
        action={
          <div className="flex items-center gap-1">
            {isAcceptedMember && (
              <Link
                href={`/app/groups/${groupId}/chat`}
                aria-label="Conversa"
                className={buttonVariants({ size: "icon", variant: "ghost", className: "relative rounded-full" })}
              >
                <MessageSquare className="size-5" />
                {snapshot.unreadCount > 0 && (
                  <span
                    aria-label={`${snapshot.unreadCount} mensagens não lidas`}
                    className="absolute top-0.5 right-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-[5px] text-[9.5px] font-extrabold text-primary-foreground"
                  >
                    {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
                  </span>
                )}
              </Link>
            )}
          </div>
        }
      />

      <NotificationPrompt />

      <div className="mt-5">
        <SegmentedControl aria-label="Seções do grupo" value={tab} onChange={setTab} options={[{ value: "saldos", label: "Saldos" }, { value: "contas", label: "Contas" }, { value: "membros", label: "Membros" }]} />
        {tab === "saldos" && <div className="mt-4">
          <GroupSettlementView
            groupId={groupId}
            snapshot={snapshot}
            meId={meId ?? ""}
          />
        </div>}
        {tab === "contas" && <div className="mt-4 space-y-4">
          <GroupSpendingSection spending={snapshot.overview?.spending} meId={meId ?? ""} />
          <GroupExpensesSection groupId={groupId} members={members} />
        </div>}
        {tab === "membros" && <div className="mt-4 space-y-4">
          {canInvite && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="min-h-11 flex-1 gap-1.5"
                onClick={() => setShowInviteModal(true)}
                aria-label="Compartilhar link e QR code do grupo"
              >
                <Share2 className="size-4" />
                Link e QR
              </Button>
              <Button
                variant="outline"
                className="min-h-11 flex-1 gap-1.5"
                onClick={() => setShowInvitePanel(!showInvitePanel)}
                aria-label="Convidar por @handle"
              >
                <UserPlus className="size-4" />
                Por @handle
              </Button>
            </div>
          )}
          <AnimatePresence>
            {showInvitePanel && canInvite && (
              <InviteByHandlePanel
                groupId={groupId}
                members={members}
                onClose={() => setShowInvitePanel(false)}
                onInvited={() => setShowInvitePanel(false)}
              />
            )}
          </AnimatePresence>
          <GroupMembersSection
            snapshot={snapshot}
            meId={meId ?? ""}
            onDepart={() => {
              departedRef.current = true;
            }}
          />
        </div>}
      </div>

      <GroupInviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        groupId={groupId}
        groupName={snapshot.group.name}
      />

      

    </div>
  );
}
