"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

export type PendingOperationStatus = "idle" | "confirming" | "confirmed" | "error";

const PENDING_OPERATION_TIMEOUT_MS = 15000;

/**
 * One contract for sheets whose mutation may stall: while `status` is
 * "confirming", `guardedDismiss` swallows close attempts (X, back, parent
 * toggles); after PENDING_OPERATION_TIMEOUT_MS `showPending` turns on so the
 * UI can offer the deliberate `onLeavePending` escape hatch, which the parent
 * always honours.
 */
export function usePendingOperation(
  status: PendingOperationStatus,
  onDismiss: () => void,
) {
  const [showPending, setShowPending] = useState(false);

  useEffect(() => {
    if (status !== "confirming") return undefined;
    const timer = window.setTimeout(
      () => setShowPending(true),
      PENDING_OPERATION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status !== "confirming") {
      setShowPending(false);
    }
  }

  const guardedDismiss = useCallback(() => {
    if (status === "confirming") return;
    onDismiss();
  }, [status, onDismiss]);

  return { showPending, guardedDismiss };
}

export function PendingOperationNotice({
  show,
  body,
  onLeave,
  testId,
}: {
  show: boolean;
  body: string;
  onLeave: () => void;
  testId: string;
}) {
  if (!show) return null;
  return (
    <div
      role="status"
      className="mb-3 rounded-2xl border border-warning/30 bg-warning/10 p-3"
      data-testid={testId}
    >
      <Chip tone="warning">
        Pendente
      </Chip>
      <div className="mt-1 flex items-center gap-1.5">
        <Clock className="size-4 text-warning-foreground" />
        <p className="text-sm font-semibold">Aguardando confirmação</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      <Button variant="outline" className="mt-2 min-h-11" onClick={onLeave}>
        Sair por enquanto
      </Button>
    </div>
  );
}
