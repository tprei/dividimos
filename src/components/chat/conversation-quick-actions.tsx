import { DollarSign, Receipt } from "lucide-react";

interface ConversationQuickActionsProps {
  onCharge: () => void;
  onSplit: () => void;
}

export function ConversationQuickActions({
  onCharge,
  onSplit,
}: ConversationQuickActionsProps) {
  return (
    <div className="flex gap-2 px-4 pb-2">
      <button
        type="button"
        onClick={onCharge}
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <DollarSign className="h-3.5 w-3.5" />
        Cobrar
      </button>
      <button
        type="button"
        onClick={onSplit}
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <Receipt className="h-3.5 w-3.5" />
        Dividir conta
      </button>
    </div>
  );
}
