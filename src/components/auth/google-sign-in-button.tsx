"use client";

import type { MouseEventHandler, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIGN_IN_BUTTON_CLASS, SIGN_IN_SPINNER_CLASS } from "./sign-in-button-styles";

export interface GoogleSignInButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>;
  pending: boolean;
  disabled: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const GOOGLE_SIGN_IN_TITLE = "Continuar com o Google";

export function GoogleSignInButton({
  onClick,
  pending,
  disabled,
  ref,
}: GoogleSignInButtonProps): React.JSX.Element {
  return (
    <Button
      ref={ref}
      type="button"
      data-google-sign-in=""
      variant="ghost"
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={pending ? "Entrando com o Google" : GOOGLE_SIGN_IN_TITLE}
      className={cn(
        SIGN_IN_BUTTON_CLASS,
        "gap-3 border-[#747775] bg-white px-4 font-[family-name:var(--font-google-sans)] text-[16.8px]/6 font-medium tracking-normal text-[#1F1F1F] hover:bg-white hover:text-[#1F1F1F] intro-narrow:gap-[11px] intro-narrow:text-[15.4px] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#131314] dark:hover:text-[#E3E3E3]",
        pending && "disabled:opacity-100",
      )}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className={SIGN_IN_SPINNER_CLASS} />
      ) : (
        // Google's configurator artwork, scaled uniformly with its 40px button proportions.
        <svg className="size-[24px] intro-narrow:size-[22px]" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
      )}
      <span aria-live="polite">{pending ? "Entrando..." : GOOGLE_SIGN_IN_TITLE}</span>
    </Button>
  );
}
