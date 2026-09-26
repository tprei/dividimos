"use client";

import { Clock } from "lucide-react";

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

interface ChatDateSeparatorProps {
  date: string;
}

export function ChatDateSeparator({ date }: ChatDateSeparatorProps) {
  return (
    <div className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5 py-2.5 before:absolute before:inset-y-0 before:left-3 before:w-px before:-translate-x-1/2 before:bg-border">
      <div aria-hidden="true" className="relative">
        <span className="absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground ring-3 ring-background">
          <Clock className="size-3" />
        </span>
      </div>
      <span className="self-center text-xs font-semibold text-muted-foreground">
        {formatDateLabel(date)}
      </span>
    </div>
  );
}

export function shouldShowDateSeparator(
  currentDate: string,
  previousDate: string | undefined,
): boolean {
  if (!previousDate) return true;
  return (
    new Date(currentDate).toISOString().slice(0, 10) !==
    new Date(previousDate).toISOString().slice(0, 10)
  );
}
