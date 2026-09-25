"use client";

import type { ComponentProps, ReactNode } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Full-bleed bar docked to the bottom of a chat screen. The body already owns
 * the bottom safe area and the shell drops its end padding for any screen
 * that contains this slot, so the bar meets the nav (or the screen edge when
 * the nav is hidden) with no gap and no doubled inset.
 */
export function ComposerDock({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-slot="chat-composer"
      className={cn("shrink-0 space-y-2 border-t border-border bg-surface px-3 py-2", className)}
    >
      {children}
    </div>
  );
}

/** The rounded field inside the dock; `active` tints it while AI mode is on. */
export function ComposerField({
  active = false,
  align = "center",
  children,
}: {
  active?: boolean;
  align?: "center" | "end";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-1 rounded-3xl bg-card p-1 ring-1 transition-[box-shadow,background-color] focus-within:ring-2",
        align === "end" ? "items-end" : "items-center",
        active
          ? "bg-primary/5 ring-primary/60 focus-within:ring-primary/70"
          : "ring-border focus-within:ring-ring/60",
      )}
    >
      {children}
    </div>
  );
}

type ComposerSendButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant" | "children"> & {
  sending?: boolean;
};

/** Amber when there is something to send; recedes into the field otherwise. */
export function ComposerSendButton({ sending = false, className, ...props }: ComposerSendButtonProps) {
  return (
    <Button
      type="button"
      size="icon"
      className={cn(
        "rounded-full disabled:bg-transparent disabled:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {sending ? <Loader2 className="animate-spin" /> : <Send />}
    </Button>
  );
}
