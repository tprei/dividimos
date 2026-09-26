"use client";

import { motion, useReducedMotion } from "framer-motion";
import { MessageSquare, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GroupAvatarEditor } from "@/components/group/group-avatar-editor";
import { GroupHero } from "@/components/group/group-hero";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { GroupMembersSection } from "@/components/group/group-members-section";
import { GroupSpendingSection } from "@/components/group/group-spending-section";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { haptics } from "@/hooks/use-haptics";
import { springs } from "@/lib/animations";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupSnapshot } from "@/types/ledger";

export interface GroupProfileViewProps {
  groupId: string;
  snapshot: GroupSnapshot;
  meId: string | null;
  onClose: () => void;
  onShowMembers: () => void;
  onDepart: () => void;
}

const bodyVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { ...springs.reveal, delay: 0.06 } },
};

const bodyReducedVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

/**
 * The expanded face of a group, shown in place of the Saldos/Contas/Membros
 * tabs.
 */
export function GroupProfileView({ groupId, snapshot, meId, onClose, onShowMembers, onDepart }: GroupProfileViewProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorAnchor, setEditorAnchor] = useState<HTMLElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;

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
        onBack={onClose}
        onEditPhoto={canEditAvatar ? (anchor) => { haptics.tap(); setEditorAnchor(anchor); setEditorOpen(true); } : undefined}
      />

      <motion.div variants={reduced ? bodyReducedVariants : bodyVariants} className="px-4 md:px-0">
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
          <button
            type="button"
            onClick={onShowMembers}
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left font-semibold transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AvatarStack people={[
              ...members.map((member) => ({ id: member.userId, name: member.user.name, avatarUrl: member.user.avatarUrl })),
              ...snapshot.guests.map((guest) => ({ id: guest.id, name: guest.displayName, avatarUrl: null, isGuest: true })),
            ]} />
            <span>{members.length + snapshot.guests.length} pessoas</span>
          </button>
          <GroupSpendingSection spending={overview?.spending} meId={meId ?? ""} />
          <GroupMembersSection
            settingsOnly
            snapshot={snapshot}
            meId={meId ?? ""}
            onDepart={onDepart}
          />
        </div>
      </motion.div>
      {canEditAvatar && <GroupAvatarEditor groupId={groupId} open={editorOpen} onOpenChange={setEditorOpen} anchor={editorAnchor} />}
    </div>
  );
}
