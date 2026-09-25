"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface WizardFooterProps {
  /** Null on the first step: there is nothing to go back to. */
  onBack: (() => void) | null;
  onContinue: () => void;
  continueLabel: string;
  disabled?: boolean;
  /** Why the button is disabled, in the user's words. */
  reason?: string | null;
  loading?: boolean;
}

export function WizardFooter({
  onBack,
  onContinue,
  continueLabel,
  disabled = false,
  reason = null,
  loading = false,
}: WizardFooterProps) {
  return (
    // In normal flow, not floating: a fixed bar covers the last rows and
    // fights the keyboard on short screens.
    <footer className="mt-auto border-t px-4 py-3">
      {disabled && reason ? (
        <p className="mb-2 text-center text-xs font-medium text-muted-foreground" role="status">
          {reason}
        </p>
      ) : null}
      <div className="flex gap-2">
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 flex-1"
            onClick={onBack}
            disabled={loading}
          >
            Voltar
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          className="h-12 flex-[2] text-base font-bold disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:ring-1 disabled:ring-border"
          disabled={disabled || loading}
          onClick={onContinue}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Salvando…
            </>
          ) : (
            continueLabel
          )}
        </Button>
      </div>
    </footer>
  );
}
