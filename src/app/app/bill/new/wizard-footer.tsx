"use client";

import { ArrowLeft, ArrowRight, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";

export interface WizardErrorInputs {
  step: string;
  participantCount: number;
  totalAmountInput: number;
  assignedAmountCents: number;
  grandTotal: number;
  paidTotalCents: number;
  pendingInviteNames: string[];
  wouldProduceNoEdges: boolean;
}

export function computeWizardError({
  step,
  participantCount,
  totalAmountInput,
  assignedAmountCents,
  grandTotal,
  paidTotalCents,
  pendingInviteNames,
  wouldProduceNoEdges,
}: WizardErrorInputs): string | null {
  if (step === "participants" && participantCount < 2) {
    return "Adicione pelo menos uma pessoa para dividir a conta";
  }
  if (step === "amount-split") {
    if (totalAmountInput <= 0) return "Informe o valor total da conta";
    if (Math.abs(totalAmountInput - assignedAmountCents) > 1) {
      return `A divisão (${formatBRL(assignedAmountCents)}) não bate com o total (${formatBRL(totalAmountInput)})`;
    }
  }
  if (step === "payer") {
    if (paidTotalCents > 0 && grandTotal > 0 && Math.abs(grandTotal - paidTotalCents) > 1) {
      return `O pagamento (${formatBRL(paidTotalCents)}) não bate com o total (${formatBRL(grandTotal)})`;
    }
  }
  if (step === "summary") {
    if (pendingInviteNames.length > 0) {
      return `Aguardando ${pendingInviteNames.join(", ")} aceitar o convite`;
    }
    if (wouldProduceNoEdges) {
      return "Nenhuma dívida será gerada — quem pagou já consumiu tudo que pagou. Ajuste a divisão ou os pagadores.";
    }
  }
  return null;
}

export interface WizardFooterProps {
  isSummary: boolean;
  isEditing: boolean;
  busy: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onNext: () => Promise<void>;
  onBack: () => void;
}

export function WizardFooter({
  isSummary,
  isEditing,
  busy,
  disabled,
  errorMessage,
  onNext,
  onBack,
}: WizardFooterProps) {
  return (
    <div className="mt-6">
      {errorMessage && (
        <p className="mb-2 text-center text-xs text-destructive">{errorMessage}</p>
      )}
      {isSummary ? (
        <div className="flex flex-col gap-3">
          <Button
            onClick={onNext}
            className="w-full h-12 gap-2 text-base font-semibold"
            disabled={disabled}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <QrCode className="h-5 w-5" />
                {isEditing ? "Salvar alterações" : "Gerar cobranças Pix"}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={onBack}
            className="gap-1 text-muted-foreground"
            disabled={busy}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </div>
      ) : (
        <div className="flex gap-3">
          <Button
            variant="ghost"
            onClick={onBack}
            className="gap-1 text-muted-foreground h-10"
            disabled={busy}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <Button
            onClick={onNext}
            className="flex-1 gap-2 h-10 text-base font-medium"
            disabled={disabled}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Próximo
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
