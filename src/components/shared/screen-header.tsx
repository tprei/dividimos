"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  back?: boolean;
  onBack?: () => void;
  leading?: ReactNode;
  action?: ReactNode;
}

export function ScreenHeader({ title, eyebrow, back = false, onBack, leading, action }: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <header className="flex items-center gap-2 px-4 pt-5 pb-3">
      {back && (
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Voltar"
          className="-ml-2 rounded-full"
          onClick={onBack ?? (() => router.back())}
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}
      {leading}
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="truncate text-[22px] leading-tight font-bold tracking-tight">{title}</h1>
      </div>
      {action}
    </header>
  );
}
