"use client";

import { Loader2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { joinViaLink } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";

interface JoinActionsProps {
  token: string;
  isAuthenticated: boolean;
}

export function JoinActions({ token, isAuthenticated }: JoinActionsProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        Criar conta e entrar no grupo
      </Button>
    );
  }

  const handleJoin = async () => {
    setJoining(true);
    setError(null);

    try {
      const ack = await joinViaLink(token);
      router.push(`/app/groups/${ack.groupId}`);
    } catch (error) {
      setError(ledgerErrorMessage(error));
      setJoining(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full gap-2"
        size="lg"
        onClick={handleJoin}
        disabled={joining}
      >
        {joining ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        Entrar no grupo
      </Button>
      {error && (
        <p role="alert" className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
