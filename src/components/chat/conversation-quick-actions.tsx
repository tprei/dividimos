import { HandCoins, ReceiptText } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

interface ConversationQuickActionsProps {
  /** Receives the pressed control so the charge form anchors to it. */
  onCharge: (anchor: HTMLButtonElement) => void;
  onSplit: () => void;
}

export function ConversationQuickActions({
  onCharge,
  onSplit,
}: ConversationQuickActionsProps) {
  return (
    <>
      <IconButton
        aria-label="Nova cobrança"
        title="Nova cobrança"
        className="text-muted-foreground"
        onClick={(event) => onCharge(event.currentTarget)}
      >
        <HandCoins className="size-5" />
      </IconButton>
      <IconButton
        aria-label="Dividir conta"
        title="Dividir conta"
        className="text-muted-foreground"
        onClick={onSplit}
      >
        <ReceiptText className="size-5" />
      </IconButton>
    </>
  );
}
