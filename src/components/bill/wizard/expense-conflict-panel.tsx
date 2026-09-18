"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBrazilianDate } from "@/lib/datetime";
import { describeVersion } from "@/components/expense/change-summary-copy";
import type { ExpenseDetail } from "@/types/ledger";
import { cn } from "@/lib/utils";

export interface ExpenseConflictPanelProps {
  status: "loading" | "ready" | "error";
  detail: ExpenseDetail | null;
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

  const sentences = (() => {
    if (status !== "ready" || !detail) return [];
    const nameOf = (userId: string) => {
      const p = detail.participants.find((item) => item.user?.id === userId);
      return p?.user?.name ?? "alguém";
    };
    const list = describeVersion(detail.current, {
      authorName: authorName ?? "Alguém",
      nameOf,
    });
    if (detail.current.createdAt) {
      list.push(`Editado em ${formatTimestamp(detail.current.createdAt)}`);
    }
    return list.slice(0, 4);
  })();

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        "rounded-2xl border border-warning/30 bg-warning/10 p-4 outline-none",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold leading-snug">{heading}</h2>
          {status === "ready" && detail && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {sentences.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          {status === "loading" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Carregando a versão mais recente...
            </p>
          )}
          {status === "error" && (
            <p className="mt-1 text-xs text-destructive-text">
              Não deu pra carregar a versão mais recente. Suas edições continuam aqui.
            </p>
          )}
          {status === "ready" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Carregar substitui o que você digitou.
            </p>
          )}
        </div>
      </div>
      <Button
        type="button"
        className="mt-3 min-h-11 w-full rounded-lg"
        variant={status === "error" ? "outline" : "default"}
        disabled={status === "loading"}
        onClick={status === "error" ? onRetry : onAccept}
      >
        {status === "loading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando...
          </>
        ) : status === "error" ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar de novo
          </>
        ) : (
          "Carregar versão mais recente"
        )}
      </Button>
    </div>
  );
}
