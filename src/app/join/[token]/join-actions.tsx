"use client";

import { Loader2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

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

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "join_via_link",
      { p_token: token },
    );

    if (rpcError) {
      const msg = rpcError.message;
      if (msg.includes("invalid_link") || msg.includes("invalid_token")) {
        setError("Convite inválido ou não encontrado.");
      } else if (msg.includes("link_inactive")) {
        setError("Este convite foi desativado.");
      } else if (msg.includes("link_expired")) {
        setError("Este convite expirou.");
      } else if (msg.includes("link_exhausted")) {
        setError("Este convite atingiu o limite de usos.");
      } else {
        setError("Erro ao entrar no grupo. Tente novamente.");
      }
      setJoining(false);
      return;
    }

    const result = data as { groupId?: string; group_id?: string } | null;
    const groupId = result?.groupId ?? result?.group_id;
    router.push(`/app/groups/${groupId}`);
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
