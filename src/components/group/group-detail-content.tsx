"use client";

import { AnimatePresence } from "framer-motion";
import { MessageSquare, Share2, UserPlus, UsersRound } from "lucide-react";
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
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrefetchRoutes } from "@/hooks/use-prefetch-routes";
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
  const [tab, setTab] = useState("saldos");
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
      <ScreenHeader
        back
        eyebrow={tab === "saldos" ? snapshot.group.name : `${accepted.length} membro${accepted.length !== 1 ? "s" : ""}`}
        title={tab === "saldos" ? "Acerto do grupo" : snapshot.group.name}
        onBack={() => router.push("/app/groups")}
        action={
          canInvite ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="icon-lg"
                variant="outline"
                className="size-11"
                onClick={() => setShowInviteModal(true)}
                aria-label="Compartilhar convite"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="min-h-11 gap-1.5"
                onClick={() => setShowInvitePanel(!showInvitePanel)}
              >
                <UserPlus className="h-4 w-4" />
                Convidar
              </Button>
            </div>
          ) : undefined
        }
      />
      {isAcceptedMember && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            className="relative min-h-11 gap-1.5 rounded-full"
            render={<Link href={`/app/groups/${groupId}/chat`} aria-label="Conversa" />}
          >
            <MessageSquare className="h-5 w-5" />
            Conversa
            {snapshot.unreadCount > 0 && (
              <span
                aria-label={`${snapshot.unreadCount} mensagens não lidas`}
                className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-[5px] text-[9.5px] font-extrabold text-primary-foreground"
              >
                {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
              </span>
            )}
          </Button>
        </div>
      )}

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

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList className="w-full">
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="membros">Membros</TabsTrigger>
        </TabsList>
        <TabsContent value="saldos" className="mt-4">
          <GroupSettlementView
            groupId={groupId}
            snapshot={snapshot}
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
