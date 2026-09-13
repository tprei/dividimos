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
    <footer className="sticky bottom-0 mt-auto border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom">
      {disabled && reason ? (
        <p className="mb-2 text-center text-xs font-medium text-destructive" role="status">
          {reason}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="min-h-12 h-12 w-full text-base font-bold"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </Button>
    </footer>
  );
}
