"use client";

import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { refreshSettlement } from "@/lib/sync/refresh";
import { cn } from "@/lib/utils";
import { settlementReadKey, useAppStore } from "@/stores/app-store";
import type { SettlementStatus } from "@/types/ledger";

const STATUS_CONFIG: Record<SettlementStatus, { label: string; className: string }> = {
  confirmed: { label: "Confirmado", className: "bg-success/15 text-success" },
  voided: { label: "Desfeito", className: "bg-muted text-muted-foreground" },
};

interface Person {
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

const UNKNOWN_PERSON: Person = { name: "Participante", avatarUrl: null, isBot: false };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function SettlementDetailSheet({
  settlementId,
  groupId,
  open,
  onOpenChange,
}: {
  settlementId: string;
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settlement = useAppStore((s) => s.settlementDetails[settlementId]);
  const read = useAppStore((s) => s.reads[settlementReadKey(settlementId)]);
  const group = useAppStore((s) => s.groups[groupId]);

  useEffect(() => {
    if (!open || read?.status === "loading" || read?.status === "error") return;
    void refreshSettlement(settlementId).catch(() => undefined);
  }, [open, read?.status, settlementId]);

  const resolvePerson = useCallback(
    (userId: string): Person => {
      const member = group?.members.find((m) => m.user.id === userId);
      if (member) {
        return { name: member.user.name, avatarUrl: member.user.avatarUrl, isBot: member.user.isBot };
      }
      const guest = group?.guests.find((g) => g.id === userId);
      if (guest) return { name: guest.displayName, avatarUrl: null, isBot: false };
      return UNKNOWN_PERSON;
    },
    [group],
  );

  const retry = useCallback(() => {
    void refreshSettlement(settlementId).catch(() => undefined);
  }, [settlementId]);

  const payer = settlement ? resolvePerson(settlement.fromUserId) : null;
  const recipient = settlement ? resolvePerson(settlement.toUserId) : null;
  const cfg = settlement ? STATUS_CONFIG[settlement.status] : null;

  const readError = read?.status === "error" ? read : null;
  const denied =
    readError !== null && (readError.code === "not_a_member" || readError.code === "settlement_not_found");
  const notFound = readError !== null && readError.code === "settlement_not_found";
  const failed = readError !== null && !denied;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-t-3xl pb-6 safe-bottom"
        data-testid="settlement-detail-sheet"
      >
        <SheetHeader>
          <SheetTitle>Pagamento</SheetTitle>
          <SheetDescription>Registro deste pagamento no grupo.</SheetDescription>
        </SheetHeader>

        {settlement && payer && recipient && cfg ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                <UserAvatar name={payer.name} avatarUrl={payer.avatarUrl} size="sm" isBot={payer.isBot} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" data-testid="settlement-detail-payer">
                    {payer.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Quem pagou</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-right">
                  <p className="truncate text-sm font-medium" data-testid="settlement-detail-recipient">
                    {recipient.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Quem recebeu</p>
                </div>
                <UserAvatar
                  name={recipient.name}
                  avatarUrl={recipient.avatarUrl}
                  size="sm"
                  isBot={recipient.isBot}
                />
              </div>
              <div className="mt-3 text-center" data-testid="settlement-detail-amount">
                <Money cents={settlement.amountCents} className="text-xl" label="Valor do pagamento" />
              </div>
              <div className="mt-2 flex flex-col items-center gap-1">
                <span
                  className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", cfg.className)}
                  data-testid="settlement-detail-status"
                >
                  {cfg.label}
                </span>
                <p className="text-xs text-muted-foreground">
                  Registrado em {formatDate(settlement.createdAt)}
                </p>
                {settlement.voidedAt && (
                  <p className="text-xs text-muted-foreground" data-testid="settlement-detail-voided-at">
                    Desfeito em {formatDate(settlement.voidedAt)}
                  </p>
                )}
              </div>
            </div>

            {read?.status === "loading" && (
              <p
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
                data-testid="settlement-detail-updating"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Atualizando…
              </p>
            )}
            {failed && (
              <div className="space-y-2 text-center" data-testid="settlement-detail-stale">
                <p className="text-xs text-warning">
                  Não deu para atualizar agora — mostrando o último valor salvo.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs"
                  onClick={retry}
                  data-testid="settlement-detail-retry"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Tentar novamente
                </Button>
              </div>
            )}
            <p className="text-center text-[11px] text-muted-foreground">
              Registro do grupo. Não é comprovante bancário.
            </p>
          </div>
        ) : denied ? (
          <div className="space-y-1 py-4 text-center" data-testid="settlement-detail-unavailable">
            <p className="text-sm font-medium">
              {notFound ? "Pagamento não encontrado" : "Pagamento indisponível"}
            </p>
            <p className="text-xs text-muted-foreground">
              {notFound
                ? "Este registro não existe ou foi removido."
                : "Você não tem mais acesso ao grupo deste pagamento."}
            </p>
          </div>
        ) : failed ? (
          <div className="space-y-3 py-4 text-center" data-testid="settlement-detail-error">
            <p className="text-sm text-muted-foreground">Não foi possível carregar o pagamento.</p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 text-xs"
              onClick={retry}
              data-testid="settlement-detail-retry"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div
            className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
            data-testid="settlement-detail-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando pagamento…
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
