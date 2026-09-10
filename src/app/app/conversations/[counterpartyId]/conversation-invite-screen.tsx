"use client";

import { Check, X } from "lucide-react";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/types/ledger";

interface ConversationInviteScreenProps {
  counterparty: UserProfile;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConversationInviteScreen({
  counterparty,
  onAccept,
  onDecline,
}: ConversationInviteScreenProps) {
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader back title={counterparty.name} eyebrow={`@${counterparty.handle}`} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <UserAvatar name={counterparty.name} avatarUrl={counterparty.avatarUrl} size="lg" />
        <div className="space-y-1">
          <p className="font-semibold">{counterparty.name}</p>
          <p className="text-sm text-muted-foreground">
            Esta conversa está pendente. @{counterparty.handle} convidou você a conversar.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button onClick={onAccept} className="w-full gap-2">
            <Check className="h-4 w-4" />
            Aceitar convite
          </Button>
          <Button variant="outline" onClick={onDecline} className="w-full gap-2">
            <X className="h-4 w-4" />
            Recusar
          </Button>
        </div>
      </div>
    </div>
  );
}
