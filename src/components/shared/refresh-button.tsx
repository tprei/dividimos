"use client";

import { RotateCw } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

export interface RefreshButtonProps {
  refreshing: boolean;
  onRefresh: () => void;
}

export function RefreshButton({ refreshing, onRefresh }: RefreshButtonProps) {
  return (
    <IconButton
      aria-label={refreshing ? "Atualizando" : "Atualizar"}
      aria-busy={refreshing}
      disabled={refreshing}
      onClick={() => {
        haptics.tap();
        onRefresh();
      }}
      className="rounded-full"
    >
      <RotateCw
        className={cn("size-5", refreshing && "motion-safe:animate-spin")}
        aria-hidden="true"
      />
    </IconButton>
  );
}
