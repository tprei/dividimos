"use client";

import { Clock, Loader2, LogIn, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface ClaimActionsProps {
  token: string;
  expenseId: string;
  isAuthenticated: boolean;
  expenseStatus: string;
}

export function ClaimActions({
  token,
  expenseId,
  isAuthenticated,
  expenseStatus,
}: ClaimActionsProps) {
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (expenseStatus !== "active") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
        <Clock className="h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          Aguardando ativacao da despesa
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          O criador ainda nao finalizou esta conta. Voce podera confirmar assim
          que a despesa estiver ativa.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Button
        className="w-full gap-2"
        size="lg"
        onClick={() => {
          const redirect = encodeURIComponent(`/claim/${token}`);
          router.push(`/auth?next=${redirect}`);
        }}
      >
        <LogIn className="h-4 w-4" />
        Criar conta e confirmar
      </Button>
    );
  }

  const handleClaim = async () => {
    setClaiming(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("claim_guest_spot", {
      p_claim_token: token,
    });

    if (rpcError) {
      const msg = rpcError.message;
      if (msg.includes("duplicate_participant")) {
        setError("Você já está incluso nessa despesa!");
      } else if (msg.includes("already_claimed")) {
        setError("Este convite já foi aceito por outra pessoa.");
      } else if (msg.includes("invalid_token")) {
        setError("Convite inválido ou expirado.");
      } else {
        setError("Erro ao confirmar participação. Tente novamente.");
      }
      setClaiming(false);
      return;
    }

    router.push(`/app/bill/${expenseId}`);
  };

  return (
    <div className="space-y-3">
      <Button
        className="w-full gap-2"
        size="lg"
        onClick={handleClaim}
        disabled={claiming}
      >
        {claiming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserCheck className="h-4 w-4" />
        )}
        Confirmar meu lugar
      </Button>
      {error && (
        <p className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
