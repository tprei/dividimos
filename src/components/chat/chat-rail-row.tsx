import type { ReactNode } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

export type ChatRailMarker =
  | { kind: "expense" | "payment" | "system" | "message" }
  | { kind: "avatar"; id: string; name: string; avatarUrl: string | null; isBot: boolean };

export function formatChatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DOT_CLASSES = {
  expense: "top-3.5 size-2 bg-primary",
  payment: "top-3.5 size-2 bg-success",
  system: "top-1.25 size-1.5 bg-muted-foreground/60",
  message: "top-3.5 size-1.5 bg-muted-foreground/35",
} as const;

interface ChatRailRowProps {
  marker: ChatRailMarker;
  spaced?: boolean;
  children: ReactNode;
}

export function ChatRailRow({ marker, spaced = false, children }: ChatRailRowProps) {
  return (
    <div
      className={cn(
        "relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5 before:absolute before:inset-y-0 before:left-3 before:w-px before:-translate-x-1/2 before:bg-border",
        spaced && "pt-2.5",
      )}
    >
      <div aria-hidden="true" className="relative">
        {marker.kind === "avatar" ? (
          <UserAvatar
            id={marker.id}
            name={marker.name}
            avatarUrl={marker.avatarUrl}
            isBot={marker.isBot}
            size="xs"
            className="absolute top-0.5 left-0 ring-3 ring-background"
          />
        ) : (
          <span
            className={cn(
              "absolute left-1/2 -translate-x-1/2 rounded-full ring-3 ring-background",
              DOT_CLASSES[marker.kind],
            )}
          />
        )}
      </div>
      <div className="min-w-0 pb-1.5">{children}</div>
    </div>
  );
}
