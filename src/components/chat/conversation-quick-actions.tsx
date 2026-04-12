import Link from "next/link";
import { DollarSign, Receipt } from "lucide-react";

interface ConversationQuickActionsProps {
  groupId: string;
  counterpartyName: string;
}

export function ConversationQuickActions({
  groupId,
  counterpartyName,
}: ConversationQuickActionsProps) {
  return (
    <div className="flex gap-2 px-4 pb-2">
      <Link
        href={`/app/bill/new?groupId=${groupId}&type=single_amount&dm=${encodeURIComponent(counterpartyName)}`}
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <DollarSign className="h-3.5 w-3.5" />
        Cobrar
      </Link>
      <Link
        href={`/app/bill/new?groupId=${groupId}&type=itemized&dm=${encodeURIComponent(counterpartyName)}`}
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <Receipt className="h-3.5 w-3.5" />
        Dividir conta
      </Link>
    </div>
  );
}
