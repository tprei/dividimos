"use client";

import { AlertCircle, Loader2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface JoinActionsProps {
  token: string;
  isAuthenticated: boolean;
  isInvalid: boolean;
  isExpired: boolean;
  isExhausted: boolean;
  isInactive: boolean;
}

export function JoinActions({
  token,
  isAuthenticated,
  isInvalid,
  isExpired,
  isExhausted,
  isInactive,
}: JoinActionsProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isInvalid) {
    const reason = isInactive
      ? "Este convite foi desativado."
      : isExpired
        ? "Este convite expirou."
        : isExhausted
          ? "Este convite atingiu o limite de usos."
          : "Este convite não é mais válido.";

    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Convite indisponível</p>
        <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
      </div>
    );
  }

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
      "join_group_via_link",
      { p_token: token },
    );

    if (rpcError) {
      const msg = rpcError.message;
      if (msg.includes("invalid_token")) {
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

    const result = data as { group_id: string; already_member: boolean };

    if (result.already_member) {
      router.push(`/app/groups/${result.group_id}`);
      return;
    }

    router.push(`/app/groups/${result.group_id}`);
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
        <p className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
