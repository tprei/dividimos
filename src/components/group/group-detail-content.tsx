"use client";

import { AnimatePresence } from "framer-motion";
import { ArrowLeft, Share2, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { GroupExpensesSection } from "@/components/group/group-expenses-section";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { InviteByHandlePanel } from "@/components/group/group-invite-panel";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupSettlementView } from "@/components/group/group-settlement-view";
import { NotificationPrompt } from "@/components/pwa/notification-prompt";
import { EmptyState } from "@/components/shared/empty-state";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrefetchRoutes } from "@/hooks/use-prefetch-routes";
import { debtRowsForGroup } from "@/lib/ledger/debt-rows";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";

const UNAVAILABLE_CODES: Record<string, true> = {
  not_a_member: true,
  group_not_found: true,
};

export function GroupDetailContent({ groupId }: { groupId: string }) {
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  const meId = useAppStore((s) => s.me?.id ?? null);
  const snapshot = useAppStore((s) => s.groups[groupId]);
  const [loadError, setLoadError] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const departedRef = useRef(false);

  usePrefetchRoutes(useMemo(() => [`/app/bill/new?groupId=${groupId}`], [groupId]));

  useEffect(() => {
    if (!hydrated || snapshot || loadError || departedRef.current) return;
    refreshGroup(groupId).catch((e: unknown) => {
      if (e instanceof LedgerError && UNAVAILABLE_CODES[e.code]) {
        setLoadError(true);
      } else {
        toast.error(ledgerErrorMessage(e));
      }
    });
  }, [hydrated, snapshot, groupId, loadError]);

  const debtRows = useMemo(
    () => (snapshot && meId !== null ? debtRowsForGroup(snapshot, meId) : []),
    [snapshot, meId],
  );

  if (!hydrated || (!snapshot && !loadError)) {
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
  const accepted = members.filter((m) => m.status === "accepted");
  const isCreator = meId === snapshot.group.creatorId;
  const isAcceptedMember = accepted.some((m) => m.userId === meId);
  const canInvite = meId !== null && (isCreator || isAcceptedMember);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app/groups"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{snapshot.group.name}</h1>
          <p className="text-xs text-muted-foreground">
            {accepted.length} membro{accepted.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex -space-x-2">
          {accepted.slice(0, 4).map((m) => (
            <UserAvatar
              key={m.userId}
              name={m.user.name}
              avatarUrl={m.user.avatarUrl}
              size="xs"
              className="ring-2 ring-card"
            />
          ))}
          {accepted.length > 4 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-bold ring-2 ring-card">
              +{accepted.length - 4}
            </div>
          )}
        </div>
        {canInvite && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setShowInviteModal(true)}
              aria-label="Compartilhar convite"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowInvitePanel(!showInvitePanel)}
            >
              <UserPlus className="h-4 w-4" />
              Convidar
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showInvitePanel && canInvite && (
          <div className="mt-4">
            <InviteByHandlePanel
              groupId={groupId}
              members={members}
              onClose={() => setShowInvitePanel(false)}
              onInvited={() => setShowInvitePanel(false)}
            />
          </div>
        )}
      </AnimatePresence>

      <NotificationPrompt />

      <Tabs defaultValue="saldos" className="mt-5">
        <TabsList className="w-full">
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="membros">Membros</TabsTrigger>
        </TabsList>
        <TabsContent value="saldos" className="mt-4">
          <GroupSettlementView
            groupId={groupId}
            rows={debtRows}
            meId={meId ?? ""}
          />
        </TabsContent>
        <TabsContent value="contas" className="mt-4">
          <GroupExpensesSection groupId={groupId} members={members} />
        </TabsContent>
        <TabsContent value="membros" className="mt-4">
          <GroupMembersSection
            snapshot={snapshot}
            meId={meId ?? ""}
            onDepart={() => {
              departedRef.current = true;
            }}
          />
        </TabsContent>
      </Tabs>

      <GroupInviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        groupId={groupId}
        groupName={snapshot.group.name}
      />

    </div>
  );
}
