"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncErrorStateProps {
  message: string;
  onRetry: () => void;
  /** Defaults to a generic read failure. */
  title?: string;
  /** True while the retry read is in flight. */
  retrying?: boolean;
}

/**
 * Shown when a read failed and there is nothing trustworthy to display. It is
 * deliberately not an empty state: an empty list and a failed read mean
 * different things to the user.
 */
export function SyncErrorState({
  message,
  onRetry,
  title = "Não foi possível carregar",
  retrying,
}: SyncErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
      <WifiOff className="h-8 w-8 text-muted-foreground opacity-50" strokeWidth={1.5} />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p role="alert" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
      <Button
        onClick={onRetry}
        disabled={retrying}
        className="mt-2 w-full max-w-xs gap-2"
      >
        <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
        {retrying ? "Tentando..." : "Tentar novamente"}
      </Button>
    </div>
  );
}
