"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { formatBrazilianDate } from "@/lib/datetime";
import type { ExpenseDetail } from "@/types/ledger";
import { cn } from "@/lib/utils";

export interface ExpenseConflictPanelProps {
  status: "loading" | "ready" | "error";
  detail: ExpenseDetail | null;
  errorMessage?: string;
  onRetry: () => void;
  onAccept: () => void;
  className?: string;
}

function formatTimestamp(iso: string): string {
  try {
    return formatBrazilianDate(iso, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ExpenseConflictPanel({
  status,
  detail,
  errorMessage,
  onRetry,
  onAccept,
  className,
}: ExpenseConflictPanelProps) {
  if (status === "error") {
    return (
      <div
        className={cn(
          "rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-destructive",
          className,
        )}
      >
        <p className="text-sm font-medium">
          Não foi possível carregar a versão mais recente.
        </p>
        {errorMessage && errorMessage !== "Não foi possível carregar a versão mais recente." && (
          <p className="mt-1 text-xs opacity-90">{errorMessage}</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 gap-2 rounded-lg"
          onClick={onRetry}
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  const isReady = status === "ready";
  const title =
    detail?.current.changeSummary?.title?.[1] ??
    detail?.current.title ??
    "Conta atualizada";

  const authorName = detail?.participants.find(
    (p) => p.user?.id === detail.current.authorId,
  )?.user?.name;

  return (
    <div className={cn("space-y-4", className)}>
      <div
        role="alert"
        className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-foreground"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold leading-snug">
              Esta conta foi alterada por outra pessoa enquanto você editava.
            </h2>
            <p className="text-xs text-muted-foreground">
              Suas alterações não podem ser salvas por cima da versão atual.
            </p>
          </div>
        </div>
      </div>

      {isReady && detail && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            VERSÃO MAIS RECENTE
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold leading-snug">{title}</h3>
            <Money
              cents={detail.current.totalCents}
              className="font-mono text-base font-semibold"
            />
          </div>

          {detail.current.payload.payers.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-3">
              {detail.current.payload.payers.map((payer, idx) => {
                const p = detail.participants.find(
                  (part) => part.participantIndex === payer.participantIndex,
                );
                const name =
                  p?.user?.name ??
                  p?.guest?.displayName ??
                  `Participante ${payer.participantIndex + 1}`;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs text-muted-foreground"
                  >
                    <span>Pago por {name}</span>
                    <Money cents={payer.amountCents} className="font-mono" />
                  </div>
                );
              })}
            </div>
          )}

          {detail.participants.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-3">
              {detail.participants.map((p) => {
                const name =
                  p.user?.name ??
                  p.guest?.displayName ??
                  `Participante ${p.participantIndex + 1}`;
                return (
                  <div
                    key={p.participantIndex}
                    className="flex items-center justify-between text-xs text-muted-foreground"
                  >
                    <span>{name}</span>
                    <Money cents={p.shareCents} className="font-mono" />
                  </div>
                );
              })}
            </div>
          )}

          {detail.current.createdAt && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {authorName
                ? `Editado por ${authorName} em ${formatTimestamp(detail.current.createdAt)}`
                : formatTimestamp(detail.current.createdAt)}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-center text-xs text-muted-foreground">
          Isso substitui suas alterações pela versão mais recente.
        </p>
        <Button
          type="button"
          className="min-h-11 w-full rounded-lg bg-primary font-medium text-primary-foreground"
          disabled={!isReady}
          onClick={onAccept}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando...
            </>
          ) : (
            "Carregar versão mais recente"
          )}
        </Button>
      </div>
    </div>
  );
}
