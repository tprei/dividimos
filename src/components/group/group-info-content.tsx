"use client";

import { MessageSquare, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { GroupAvatarEditor } from "@/components/group/group-avatar-editor";
import { GroupHero } from "@/components/group/group-hero";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupSpendingSection } from "@/components/group/group-spending-section";
import { EmptyState } from "@/components/shared/empty-state";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { haptics } from "@/hooks/use-haptics";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { groupReadKey, IDLE_READ, useAppStore } from "@/stores/app-store";

const UNAVAILABLE_CODES: Record<string, true> = {
  not_a_member: true,
  group_not_found: true,
};

export function GroupInfoContent({ groupId }: { groupId: string }) {
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  const meId = useAppStore((s) => s.me?.id ?? null);
  const snapshot = useAppStore((s) => s.groups[groupId]);
  const read = useAppStore((s) => s.reads[groupReadKey(groupId)] ?? IDLE_READ);
  const [loadError, setLoadError] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorAnchor, setEditorAnchor] = useState<HTMLElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(() => {
    refreshGroup(groupId).catch((e: unknown) => {
      if (e instanceof LedgerError && UNAVAILABLE_CODES[e.code]) {
        setLoadError(true);
        return;
      }
      if (useAppStore.getState().groups[groupId] !== undefined) {
        toast.error(ledgerErrorMessage(e));
      }
    });
  }, [groupId]);

  useEffect(() => {
    if (!hydrated || snapshot || loadError) return;
    if (read.status === "loading" || read.status === "error") return;
    load();
  }, [hydrated, snapshot, loadError, read.status, load]);

  if (!hydrated || (!snapshot && !loadError && read.status !== "error")) {
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

  const { group, members, overview } = snapshot;
  const accepted = members.filter((m) => m.status === "accepted");
  const isAcceptedMember = accepted.some((m) => m.userId === meId);
  const canEditAvatar = isAcceptedMember && group.kind === "group";
  const since = new Date(group.createdAt).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-lg pb-6 md:max-w-2xl md:px-4 md:pt-4">
      <GroupHero
        groupId={groupId}
        name={group.name}
        avatar={overview?.avatar}
        meta={`${accepted.length} ${accepted.length === 1 ? "membro" : "membros"} · desde ${since}`}
        onBack={() => router.push(`/app/groups/${groupId}`)}
        onEditPhoto={canEditAvatar ? (anchor) => { haptics.tap(); setEditorAnchor(anchor); setEditorOpen(true); } : undefined}
      />

      <div className="px-4 md:px-0">
        <div className="mt-6 grid grid-cols-2 gap-3">
          {isAcceptedMember && (
            <Link
              href={`/app/groups/${groupId}/chat`}
              className={cn(buttonVariants({ variant: "outline" }), "gap-2 border-border bg-card text-foreground")}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              Conversa
            </Link>
          )}
          <Button
            variant="secondary"
            className="gap-2 text-foreground"
            onClick={() => { haptics.tap(); setInviteOpen(true); }}
            disabled={!isAcceptedMember}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Convidar
          </Button>
        </div>
        <GroupInviteModal groupId={groupId} groupName={group.name} open={inviteOpen} onClose={() => setInviteOpen(false)} />

        <div className="mt-6 space-y-6">
          <Link href={`/app/groups/${groupId}?tab=membros`} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 font-semibold transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
            <AvatarStack people={[
              ...members.map((member) => ({ id: member.userId, name: member.user.name, avatarUrl: member.user.avatarUrl })),
              ...snapshot.guests.map((guest) => ({ id: guest.id, name: guest.displayName, avatarUrl: null, isGuest: true })),
            ]} />
            <span>{members.length + snapshot.guests.length} pessoas</span>
          </Link>
          <GroupSpendingSection spending={overview?.spending} meId={meId ?? ""} />
          <GroupMembersSection
            settingsOnly
            snapshot={snapshot}
            meId={meId ?? ""}
            onDepart={() => router.replace("/app/groups")}
          />
        </div>
      </div>
      {canEditAvatar && <GroupAvatarEditor groupId={groupId} open={editorOpen} onOpenChange={setEditorOpen} anchor={editorAnchor} />}
    </div>
  );
}
