"use client";

import Link from "next/link";
import { InvitationCard } from "@/components/groups/invitation-card";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type { GroupSnapshot } from "@/types/ledger";

export interface NotificationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invitations: GroupSnapshot[];
  meId: string;
}

export function NotificationsSheet({
  open,
  onOpenChange,
  invitations,
  meId,
}: NotificationsSheetProps) {
  const { accept, decline, pendingGroupId } = useInvitationActions();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-t-3xl pb-6 safe-bottom"
      >
        <SheetTitle className="px-4 pt-4 text-lg font-bold">Notificações</SheetTitle>
        {invitations.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma notificação
          </p>
        ) : (
          <div className="flex flex-col gap-3 px-4">
            {invitations.map((snapshot) => (
              <InvitationCard
                key={snapshot.group.id}
                snapshot={snapshot}
                meId={meId}
                busy={pendingGroupId === snapshot.group.id}
                onAccept={() => {
                  void accept(snapshot.group.id);
                }}
                onDecline={() => {
                  void decline(snapshot.group.id);
                }}
              />
            ))}
          </div>
        )}
        <div className="flex gap-2 px-4">
          <Link
            href="/app/scan-invite"
            className={buttonVariants({ variant: "ghost", className: "h-11 flex-1" })}
          >
            Ler convite
          </Link>
          <Link
            href="/app/activity"
            className={buttonVariants({ variant: "ghost", className: "h-11 flex-1" })}
          >
            Ver atividade
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
