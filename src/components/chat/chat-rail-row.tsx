"use client";

import type { ReactNode } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

export type ChatRailMarker =
  | { kind: "expense" | "payment" | "message" }
  | { kind: "avatar"; name: string; avatarUrl: string | null };

export function formatRailTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ChatRailRowProps {
  time: string;
  marker: ChatRailMarker;
  children: ReactNode;
}

export function ChatRailRow({ time, marker, children }: ChatRailRowProps) {
  return (
    <div className="flex gap-3 pb-3">
      <div className="w-[38px] flex-none pt-1 text-right">
        <p className="font-mono text-[10.5px] leading-none text-muted-foreground">{time}</p>
      </div>
      <div className="relative w-px flex-none bg-border">
        {marker.kind === "avatar" ? (
          <UserAvatar
            name={marker.name}
            avatarUrl={marker.avatarUrl}
            size="xs"
            className="absolute -left-[11.5px] top-0 ring-2 ring-background"
          />
        ) : (
          <span
            className={cn(
              "absolute rounded-full",
              marker.kind === "expense" && "-left-[3px] top-1.5 size-[7px] bg-primary",
              marker.kind === "payment" && "-left-[3px] top-1.5 size-[7px] bg-success",
              marker.kind === "message" && "-left-[2px] top-2 size-[5px] bg-border",
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
