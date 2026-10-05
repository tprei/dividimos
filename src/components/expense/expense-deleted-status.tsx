import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { formatBrazilianDate } from "@/lib/datetime";

interface ExpenseDeletedStatusProps {
  deletedByName: string;
  deletedByMe: boolean;
  deletedAt: string | null;
  canRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
}

export function ExpenseDeletedStatus({
  deletedByName,
  deletedByMe,
  deletedAt,
  canRestore,
  restoring,
  onRestore,
}: ExpenseDeletedStatusProps) {
  return (
    <SectionCard role="region" aria-label="Conta excluída" className="mx-4 mt-3 bg-muted p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Trash2 aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold leading-6">Conta excluída</h2>
          <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">
            {deletedByMe ? "Você" : deletedByName} excluiu essa conta
          </p>
          {deletedAt && (
            <time dateTime={deletedAt} className="mt-1 block text-xs leading-4 text-muted-foreground">
              {formatBrazilianDate(deletedAt, {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
        </div>
      </div>
      {canRestore && (
        <Button variant="outline" disabled={restoring} onClick={onRestore} className="mt-3 min-h-11 w-full bg-background">
          <RotateCcw aria-hidden="true" className="size-4" />
          {restoring ? "Restaurando…" : "Restaurar"}
        </Button>
      )}
    </SectionCard>
  );
}
