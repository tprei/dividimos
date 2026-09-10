"use client";

import { Check, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/types/ledger";

interface ConversationInviteScreenProps {
  counterparty: UserProfile;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}

export function ConversationInviteScreen({
  counterparty,
  onAccept,
  onDecline,
}: ConversationInviteScreenProps) {
  // One synchronous lock for both actions: accept and decline are competing
  // transitions and only the first may run.
  const pendingRef = useRef(false);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (which: "accept" | "decline", action: () => Promise<void>) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(which);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(ledgerErrorMessage(caught));
      } finally {
        pendingRef.current = false;
        setPending(null);
      }
    },
    [],
  );

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
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button
            onClick={() => void run("accept", onAccept)}
            disabled={pending !== null}
            className="w-full gap-2"
          >
            <Check className="h-4 w-4" />
            {pending === "accept" ? "Aceitando..." : "Aceitar convite"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void run("decline", onDecline)}
            disabled={pending !== null}
            className="w-full gap-2"
          >
            <X className="h-4 w-4" />
            {pending === "decline" ? "Recusando..." : "Recusar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
