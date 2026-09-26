"use client";

import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { Bot, MessageSquare, Share2, UserPlus, Users, UsersRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppViewport } from "@/hooks/use-app-viewport";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { GroupExpensesSection } from "@/components/group/group-expenses-section";
import { groupHeroLayoutId } from "@/components/group/group-hero";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { InviteByHandlePanel } from "@/components/group/group-invite-panel";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupProfileView } from "@/components/group/group-profile-view";
import { GroupPullReveal, PullScale } from "@/components/group/group-pull-reveal";
import { GroupSettlementView } from "@/components/group/group-settlement-view";
import { NotificationPrompt } from "@/components/pwa/notification-prompt";
import { EmptyState } from "@/components/shared/empty-state";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { haptics } from "@/hooks/use-haptics";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePrefetchRoutes } from "@/hooks/use-prefetch-routes";
import { isBotGroup } from "@/lib/bot-group";
import { fade, springs } from "@/lib/animations";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { groupReadKey, IDLE_READ, useAppStore } from "@/stores/app-store";

const UNAVAILABLE_CODES: Record<string, true> = {
  not_a_member: true,
  group_not_found: true,
};

const TABS: Record<string, true> = { saldos: true, contas: true, membros: true };

type GroupView = "main" | "profile";

const viewVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, y: 10, transition: { duration: 0.15 } },
};

const mainContentVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { ...springs.reveal, delay: 0.04 } },
};

const MAIN_HINT = { idle: "Puxe para ver o grupo", armed: "Solte para ver o grupo" };
const PROFILE_HINT = { idle: "Puxe para voltar", armed: "Solte para voltar" };

/** A view animating out stays in the DOM for a moment; it must not take taps or be read. */
function ViewLayer(props: HTMLMotionProps<"div">) {
  const isPresent = useIsPresent();
  return <motion.div {...props} inert={!isPresent} />;
}

export function GroupDetailContent({ groupId }: { groupId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const view: GroupView = searchParams.get("view") === "info" ? "profile" : "main";
  const reduced = useReducedMotion() ?? false;
  const { keyboardOpen } = useAppViewport();
  const [viewTransitioning, setViewTransitioning] = useState(false);
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
  const screenRef = useRef<HTMLDivElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  const prevViewRef = useRef<GroupView>(view);
  const swapping = useRef(false);

  const openProfile = useCallback(() => {
    const url = new URL(window.location.href);
    if (swapping.current || url.searchParams.get("view") === "info") return;
    swapping.current = true;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    url.searchParams.set("view", "info");
    window.history.pushState({ groupProfile: true }, "", `${url.pathname}${url.search}`);
  }, []);

  // Going back only when this screen pushed the profile entry keeps history
  // to one entry per visit; the marker survives remounts and reloads.
  const closeProfile = useCallback(() => {
    const url = new URL(window.location.href);
    if (swapping.current || url.searchParams.get("view") !== "info") return;
    swapping.current = true;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    if (window.history.state?.groupProfile === true) {
      window.history.back();
      return;
    }
    url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  // A view swap must start from a re-measured top: reset scroll before paint
  // and hand focus to where the swap leaves the user.
  useLayoutEffect(() => {
    const previous = prevViewRef.current;
    prevViewRef.current = view;
    swapping.current = false;
    if (previous === view) return;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    const target = view === "main"
      ? avatarButtonRef.current
      : screenRef.current?.querySelector<HTMLElement>('[data-slot="group-hero"] [aria-label="Voltar"]');
    target?.focus({ preventScroll: true });
    setViewTransitioning(true);
    const timer = window.setTimeout(() => setViewTransitioning(false), 450);
    return () => window.clearTimeout(timer);
  }, [view]);

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
      eager
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
  const invitePanelOpen = showInvitePanel && canInvite && tab === "membros" && view === "main";
  const gestureEnabled = !keyboardOpen && !viewTransitioning && !showInviteModal && !invitePanelOpen;
  return (
    <GroupPullReveal
      ref={screenRef}
      enabled={gestureEnabled}
      hint={view === "profile" ? PROFILE_HINT : MAIN_HINT}
      onPull={view === "profile" ? closeProfile : openProfile}
    >
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false}>
          {view === "profile" ? (
            <ViewLayer key="profile" variants={reduced ? fade : viewVariants} initial="hidden" animate="visible" exit="exit">
              <GroupProfileView
                groupId={groupId}
                meId={meId}
                snapshot={snapshot}
                onClose={closeProfile}
                onDepart={() => { departedRef.current = true; }}
                onShowMembers={() => { setTab("membros"); closeProfile(); }}
              />
            </ViewLayer>
          ) : (
            <ViewLayer
              key="main"
              variants={reduced ? fade : viewVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="mx-auto max-w-lg px-4 pb-6 md:max-w-2xl [&>header]:px-0 [&>header_h1]:line-clamp-2"
            >
              <ScreenHeader
                back
                leading={
                  <button
                    type="button"
                    ref={avatarButtonRef}
                    aria-label="Ver perfil do grupo"
                    onClick={() => { haptics.tap(); openProfile(); }}
                    className="flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <motion.span
                      layoutId={reduced ? undefined : groupHeroLayoutId(groupId)}
                      transition={springs.reveal}
                      style={snapshot.overview?.avatar?.kind === "photo" ? { borderRadius: "50%" } : undefined}
                      className="block"
                    >
                      <PullScale>{groupAvatar}</PullScale>
                    </motion.span>
                  </button>
                }
                subtitle={`${accepted.length + snapshot.guests.length} pessoas`}
                title={snapshot.group.name}
                onBack={() => router.push("/app/groups")}
                onTitleClick={() => { haptics.tap(); openProfile(); }}
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
                  isAcceptedMember && (
                    <IconButton
                      aria-label="Conversa"
                      className="relative"
                      nativeButton={false}
                      role="link"
                      render={<Link href={`/app/groups/${groupId}/chat`} />}
                      onClick={() => haptics.tap()}
                    >
                      <MessageSquare className="size-5" />
                      {snapshot.unreadCount > 0 && <span aria-label={`${snapshot.unreadCount} mensagens não lidas`}><UnreadBadge count={snapshot.unreadCount} /></span>}
                    </IconButton>
                  )
                }
              />

              <motion.div variants={reduced ? fade : mainContentVariants} className="mt-5">
                <SegmentedControl aria-label="Seções do grupo" value={tab} onChange={setTab} options={[{ value: "saldos", label: "Saldos" }, { value: "contas", label: "Contas" }, { value: "membros", label: "Membros" }]} />
                {tab === "saldos" && <div className="mt-4">
                  <GroupSettlementView
                    groupId={groupId}
                    snapshot={snapshot}
                    meId={meId ?? ""}
                  />
                </div>}
                {tab === "contas" && <div className="mt-4 space-y-4">
                  <GroupExpensesSection groupId={groupId} members={members} />
                </div>}
                {tab === "membros" && <div className="mt-4 space-y-4">
                  {canInvite && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1 gap-1.5"
                        onClick={() => { haptics.tap(); setShowInviteModal(true); }}
                        aria-label="Compartilhar link e QR code do grupo"
                      >
                        <Share2 className="size-4" />
                        Link e QR
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1 gap-1.5"
                        onClick={() => { haptics.tap(); setShowInvitePanel(!showInvitePanel); }}
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
              </motion.div>
              <motion.div variants={reduced ? fade : mainContentVariants} className="mt-6"><NotificationPrompt /></motion.div>

              <GroupInviteModal
                open={showInviteModal}
                onClose={() => setShowInviteModal(false)}
                groupId={groupId}
                groupName={snapshot.group.name}
              />
            </ViewLayer>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </GroupPullReveal>
  );
}
