"use client";

import type { MouseEventHandler, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIGN_IN_BUTTON_CLASS, SIGN_IN_SPINNER_CLASS } from "./sign-in-button-styles";

export interface AppleSignInButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>;
  pending: boolean;
  disabled: boolean;
  ref?: Ref<HTMLButtonElement>;
}

// Apple's pt_BR JS localization, type="continue": https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/pt_BR/appleid.auth.js
const APPLE_SIGN_IN_TITLE = "Continuar com a Apple";

export function AppleSignInButton({
  onClick,
  pending,
  disabled,
  ref,
}: AppleSignInButtonProps): React.JSX.Element {
  return (
    <Button
      ref={ref}
      type="button"
      data-apple-sign-in=""
      variant="ghost"
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={pending ? "Entrando com a Apple" : APPLE_SIGN_IN_TITLE}
      className={cn(
        SIGN_IN_BUTTON_CLASS,
        "gap-0 border-obj-border bg-black px-4 font-[family-name:system-ui] text-[20.64px]/6 font-medium tracking-[-0.022em] text-white hover:bg-black hover:text-white intro-narrow:text-[18.92px] dark:border-black dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-black",
        pending && "gap-[14.4px] disabled:opacity-100",
      )}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className={SIGN_IN_SPINNER_CLASS} />
      ) : (
        // Official medium artwork preserves its full 31 × 44 padded viewBox.
        // Source: https://devimages-cdn.apple.com/design/resources/download/Logo-Sign-in-with-Apple.dmg
        <svg className="size-[48px] w-[34px] intro-narrow:h-11 intro-narrow:w-[31.17px]" viewBox="0 0 31 44" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M15.7099491,14.8846154 C16.5675461,14.8846154 17.642562,14.3048315 18.28274,13.5317864 C18.8625238,12.8312142 19.2852829,11.852829 19.2852829,10.8744437 C19.2852829,10.7415766 19.2732041,10.6087095 19.2490464,10.5 C18.2948188,10.5362365 17.1473299,11.140178 16.4588366,11.9494596 C15.9152893,12.56548 15.4200572,13.5317864 15.4200572,14.5222505 C15.4200572,14.6671964 15.4442149,14.8121424 15.4562937,14.8604577 C15.5166879,14.8725366 15.6133185,14.8846154 15.7099491,14.8846154 Z M12.6902416,29.5 C13.8618881,29.5 14.3812778,28.714876 15.8428163,28.714876 C17.3285124,28.714876 17.6546408,29.4758423 18.9591545,29.4758423 C20.2395105,29.4758423 21.0971074,28.292117 21.9063891,27.1325493 C22.8123013,25.8038779 23.1867451,24.4993643 23.2109027,24.4389701 C23.1263509,24.4148125 20.6743484,23.4122695 20.6743484,20.5979021 C20.6743484,18.1579784 22.6069612,17.0588048 22.7156707,16.974253 C21.4353147,15.1382708 19.490623,15.0899555 18.9591545,15.0899555 C17.5217737,15.0899555 16.3501271,15.9596313 15.6133185,15.9596313 C14.8161157,15.9596313 13.7652575,15.1382708 12.521138,15.1382708 C10.1536872,15.1382708 7.75,17.0950413 7.75,20.7911634 C7.75,23.0861411 8.64383344,25.513986 9.74300699,27.0842339 C10.6851558,28.4129053 11.5065162,29.5 12.6902416,29.5 Z" />
        </svg>
      )}
      <span aria-live="polite">{pending ? "Entrando..." : APPLE_SIGN_IN_TITLE}</span>
    </Button>
  );
}
