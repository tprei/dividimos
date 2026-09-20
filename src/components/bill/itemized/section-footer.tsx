"use client";

import { Button } from "@/components/ui/button";

export interface SectionFooterProps {
  label: string;
  disabled: boolean;
  /** Why the button is disabled, in the user's words. */
  reason?: string | null;
  onClick: () => void;
}

export function SectionFooter({ label, disabled, reason, onClick }: SectionFooterProps) {
  return (
    // In normal flow, not floating: a fixed bar covers the last item rows and
    // fights the keyboard on short screens.
    <footer className="mt-auto border-t px-4 py-3">
      {disabled && reason ? (
        <p className="mb-2 text-center text-xs font-medium text-muted-foreground" role="status">
          {reason}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="min-h-12 h-12 w-full text-base font-bold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:ring-1 disabled:ring-border"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </Button>
    </footer>
  );
}
