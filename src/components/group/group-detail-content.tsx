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
          <div className="flex items-center gap-1">
            {isAcceptedMember && (
              <Button
                size="icon-lg"
                variant="ghost"
                className="relative size-11 rounded-full"
                render={<Link href={`/app/groups/${groupId}/chat`} aria-label="Conversa" />}
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
              </Button>
            )}
          </div>
        }
      />

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
        <TabsContent value="membros" className="mt-4 space-y-4">
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
