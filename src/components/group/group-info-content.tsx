"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Image as ImageIcon, MessageSquare, UserPlus, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { GroupAvatarEditor } from "@/components/group/group-avatar-editor";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupSpendingSection } from "@/components/group/group-spending-section";
import { EmptyState } from "@/components/shared/empty-state";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { ScreenHeader } from "@/components/shared/screen-header";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { Button } from "@/components/ui/button";
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
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const reducedMotion = useReducedMotion();

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
  const photoId = overview?.avatar.kind === "photo" ? overview.avatar.photoId : null;
  const since = new Date(group.createdAt).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <ScreenHeader back title={group.name} onBack={() => router.push(`/app/groups/${groupId}`)} />

      {photoId !== null && expanded ? (
        <motion.button
          type="button"
          layout={!reducedMotion}
          aria-label="Recolher imagem do grupo"
          aria-expanded
          onClick={() => setExpanded(false)}
          className="relative block aspect-square w-full overflow-hidden rounded-3xl"
        >
          <Image
            src={`/api/groups/${encodeURIComponent(groupId)}/avatar?photoId=${encodeURIComponent(photoId)}`}
            alt={group.name}
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 text-left text-xl font-bold text-white">
            {group.name}
          </span>
        </motion.button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {photoId !== null ? (
            <motion.button
              type="button"
              layout={!reducedMotion}
              aria-label="Ampliar imagem do grupo"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GroupAvatar name={group.name} avatar={overview?.avatar} groupId={groupId} size="lg" />
            </motion.button>
          ) : (
            <GroupAvatar name={group.name} avatar={overview?.avatar} groupId={groupId} size="lg" />
          )}
        </div>
      )}

      <div className="mt-4 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{group.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {accepted.length} {accepted.length === 1 ? "membro" : "membros"} · desde {since}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {isAcceptedMember && (
          <Button
            variant="outline"
            className="min-h-11 flex-col gap-1 text-xs"
            render={<Link href={`/app/groups/${groupId}/chat`} />}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            Conversa
          </Button>
        )}
        <Button
          variant="outline"
          className="min-h-11 flex-col gap-1 text-xs"
          onClick={() => router.push(`/app/groups/${groupId}?tab=membros`)}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Convidar
        </Button>
        {canEditAvatar && (
          <Button
            variant="outline"
            className="min-h-11 flex-col gap-1 text-xs"
            onClick={() => setEditorOpen(true)}
          >
            <ImageIcon className="size-4" aria-hidden="true" />
            Imagem
          </Button>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <GroupSpendingSection spending={overview?.spending} meId={meId ?? ""} />
        <GroupMembersSection
          snapshot={snapshot}
          meId={meId ?? ""}
          onDepart={() => router.replace("/app/groups")}
        />
      </div>

      <GroupAvatarEditor groupId={groupId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
