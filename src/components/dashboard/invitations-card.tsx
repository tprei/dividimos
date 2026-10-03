"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Loader2, Users } from "lucide-react";
import { useId, useState } from "react";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";

const COLLAPSED_INVITATION_COUNT = 3;

export interface HomeInvitationItem {
  groupId: string;
  kind: "group" | "dm";
  title: string;
  inviter: { id: string; name: string; avatarUrl: string | null } | null;
  memberCount: number;
}

export interface InvitationsCardProps {
  invitations: HomeInvitationItem[];
  pendingGroupId: string | null;
  onAccept: (invitation: HomeInvitationItem) => void;
  onDecline: (invitation: HomeInvitationItem) => void;
  onOpen: (invitation: HomeInvitationItem) => void;
}

function InvitationRow({ invitation, pending, onAccept, onDecline, onOpen }: {
  invitation: HomeInvitationItem;
  pending: boolean;
} & Pick<InvitationsCardProps, "onAccept" | "onDecline" | "onOpen">) {
  const isDm = invitation.kind === "dm";
  const subtitle = isDm
    ? "Quer conversar com você"
    : invitation.inviter
      ? `${invitation.inviter.name} te convidou`
      : "Você recebeu um convite para este grupo";
  const invitationLabel = isDm
    ? `conversa com ${invitation.title}`
    : `grupo ${invitation.title}`;

  return (
    <div data-slot="list-row" aria-busy={pending}>
      <ListRow
        title={invitation.title}
        subtitle={subtitle}
        leading={isDm ? (
          <UserAvatar
            id={invitation.inviter?.id ?? invitation.groupId}
            name={invitation.title}
            avatarUrl={invitation.inviter?.avatarUrl}
          />
        ) : (
          <GroupAvatar name={invitation.title} groupId={invitation.groupId} />
        )}
        trailing={<ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />}
        footer={!isDm && (
          <Chip tone="neutral" icon={<Users />}>
            {invitation.memberCount} {invitation.memberCount === 1 ? "pessoa" : "pessoas"}
          </Chip>
        )}
        onClick={() => {
          haptics.tap();
          onOpen(invitation);
        }}
      />
      <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={pending}
          aria-label={`Recusar convite para ${invitationLabel}`}
          onClick={() => {
            haptics.tap();
            onDecline(invitation);
          }}
        >
          Recusar
        </Button>
        <Button
          className="min-h-11 gap-1.5"
          disabled={pending}
          aria-label={`Aceitar convite para ${invitationLabel}`}
          onClick={() => {
            haptics.tap();
            onAccept(invitation);
          }}
        >
          {pending && <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
          <span aria-live="polite">{pending ? "Respondendo…" : "Aceitar"}</span>
        </Button>
      </div>
    </div>
  );
}

export function InvitationsCard({ invitations, pendingGroupId, onAccept, onDecline, onOpen }: InvitationsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = useId();

  if (invitations.length === 0) return null;

  const visibleInvitations = expanded ? invitations : invitations.slice(0, COLLAPSED_INVITATION_COUNT);

  return (
    <motion.section
      aria-label="Convites"
      variants={fadeUp()}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
    >
      <SectionHeading title="Convites" count={invitations.length} />
      <SectionCard id={listId} className="border-primary/30">
        {visibleInvitations.map((invitation) => (
          <InvitationRow
            key={invitation.groupId}
            invitation={invitation}
            pending={pendingGroupId === invitation.groupId}
            onAccept={onAccept}
            onDecline={onDecline}
            onOpen={onOpen}
          />
        ))}
        {invitations.length > COLLAPSED_INVITATION_COUNT && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full rounded-none border-t border-border text-xs font-semibold text-muted-foreground"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              haptics.selectionChanged();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Ver menos" : `Ver todos (${invitations.length})`}
          </Button>
        )}
      </SectionCard>
    </motion.section>
  );
}
