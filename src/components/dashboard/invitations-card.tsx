"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";
import type { HomeInvitationItem } from "./home-selectors";

const COLLAPSED_INVITATION_COUNT = 3;

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
  let subtitle = "Convite para o grupo";
  if (isDm) {
    subtitle = "Quer conversar com você";
  } else if (invitation.inviter) {
    subtitle = `${invitation.inviter.name} te convidou`;
  }
  const invitationLabel = isDm
    ? `conversa com ${invitation.title}`
    : `grupo ${invitation.title}`;

  return (
    <div data-slot="list-row" aria-busy={pending}>
      <ListRow
        title={invitation.title}
        subtitle={subtitle}
        className="py-3"
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
        onClick={() => {
          haptics.tap();
          onOpen(invitation);
        }}
      />
      <div className="flex justify-end gap-2 px-3 pb-3">
        <Button
          variant="ghost"
          className="min-h-11 text-muted-foreground"
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
          variant="secondary"
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
      <SectionCard id={listId}>
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
