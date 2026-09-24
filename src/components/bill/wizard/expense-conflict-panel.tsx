"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExpenseDetail } from "@/types/ledger";
import { cn } from "@/lib/utils";

export interface ExpenseConflictPanelProps {
  status: "loading" | "ready" | "error";
  detail: ExpenseDetail | null;
  onRetry: () => void;
  onAccept: () => void;
  className?: string;
}

export function ExpenseConflictPanel({
  status,
  detail,
  onRetry,
  onAccept,
  className,
}: ExpenseConflictPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const authorName = detail?.participants.find(
    (p) => p.user?.id === detail.current.authorId,
  )?.user?.name;

  const heading =
    status === "ready" && detail && authorName
      ? `${authorName} alterou esta conta enquanto você editava`
      : "Esta conta mudou enquanto você editava";

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        "rounded-[0.75rem] border border-warning/30 bg-warning/10 px-3 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={heading}>
          {heading}
          {status === "error" && (
            <span className="font-normal text-destructive-text">
              {" "}Não deu pra carregar a versão mais recente.
            </span>
          )}
        </p>
      </div>
      <div className="mt-1.5 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status === "loading"}
          onClick={status === "error" ? onRetry : onAccept}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Carregando…
            </>
          ) : status === "error" ? (
            <>
              <RefreshCw className="size-4" aria-hidden="true" />
              Tentar de novo
            </>
          ) : (
            "Carregar versão mais recente"
          )}
        </Button>
      </div>
    </div>
  );
}
