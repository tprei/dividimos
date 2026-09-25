"use client";

import { Loader2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { joinViaLink } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { haptics } from "@/hooks/use-haptics";

interface JoinActionsProps {
  token: string;
  isAuthenticated: boolean;
}

export function JoinActions({ token, isAuthenticated }: JoinActionsProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingGroupId, setExistingGroupId] = useState<string | null>(null);

  if (!isAuthenticated) {
    return (
      <Button
        className="w-full gap-2"
        size="lg"
        onClick={() => {
          const redirect = encodeURIComponent(`/join/${token}`);
          router.push(`/auth?next=${redirect}`);
        }}
      >
        <LogIn className="h-4 w-4" />
        Entrar no grupo
      </Button>
    );
  }

  const handleJoin = async () => {
    setJoining(true);
    setError(null);

    try {
      const ack = await joinViaLink(token);
      haptics.success();
      if (ack.eventId === null) {
        setExistingGroupId(ack.groupId);
        setJoining(false);
        return;
      }
      router.push(`/app/groups/${ack.groupId}`);
    } catch (error) {
      haptics.error();
      setError(ledgerErrorMessage(error));
      setJoining(false);
    }
  };

  return (
    <div className="space-y-3">
      {existingGroupId && <p role="status" className="text-sm text-muted-foreground">Você já faz parte deste grupo.</p>}
      <Button
        className="w-full gap-2"
        size="lg"
        onClick={existingGroupId ? () => router.push(`/app/groups/${existingGroupId}`) : handleJoin}
        disabled={joining}
      >
        {joining ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        {existingGroupId ? "Abrir grupo" : joining ? "Entrando…" : "Entrar no grupo"}
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive-text">{error}</p>
      )}
    </div>
  );
}
