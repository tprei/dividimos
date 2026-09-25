"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useScreenHeaderActions } from "./screen-header-actions";

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  titleBadge?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  leading?: ReactNode;
  action?: ReactNode;
  /** Makes the title column a button; the screen supplies its own label. */
  onTitleClick?: () => void;
  titleClickLabel?: string;
}

export function ScreenHeader({
  title,
  subtitle,
  titleBadge,
  back = false,
  onBack,
  leading,
  action,
  onTitleClick,
  titleClickLabel,
}: ScreenHeaderProps) {
  const router = useRouter();
  const shellActions = useScreenHeaderActions();
  const titleColumn = (
    <>
      <div className="flex min-w-0 items-center gap-2 [&>*:not(h1)]:shrink-0">
        <h1 title={title} className="line-clamp-2 min-w-0 text-lg leading-6 font-bold tracking-tight break-words">{title}</h1>
        {titleBadge}
      </div>
      {subtitle && <p title={subtitle} className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</p>}
    </>
  );
  return (
    <header className="flex min-h-14 items-center gap-2 px-4 py-2 compact:py-1">
      {back && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voltar"
          onClick={onBack ?? (() => router.back())}
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}
      {leading}
      {onTitleClick ? (
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onTitleClick}
          aria-label={titleClickLabel}
        >
          {titleColumn}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{titleColumn}</div>
      )}
      {(action || shellActions) && (
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {shellActions}
        </div>
      )}
    </header>
  );
}
