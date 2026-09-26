"use client";

import type { ReactNode, RefObject } from "react";
import { CalendarDays, Pencil, Users2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface StartSummaryProps {
  title: string;
  onTitleChange: (title: string) => void;
  titleRef?: RefObject<HTMLInputElement | null>;
  /** Null until the date has been answered. */
  dateLabel: string | null;
  onEditDate: () => void;
  /** Null until the group has been answered, or when there is no group to pick. */
  groupLabel: string | null;
  onEditGroup: () => void;
}

/**
 * The answers so far, folded into one card: the name stays editable in
 * place, date and group reopen their question.
 */
export function StartSummary({
  title,
  onTitleChange,
  titleRef,
  dateLabel,
  onEditDate,
  groupLabel,
  onEditGroup,
}: StartSummaryProps) {
  return (
    <div className="gradient-mesh rounded-2xl border border-border bg-card px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Input
          id="expense-title"
          ref={titleRef}
          aria-label="Nome da conta"
          placeholder="Nome da conta"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          enterKeyHint="done"
          className="h-10 min-w-0 flex-1 rounded-lg border-transparent bg-transparent px-2 text-base font-bold focus-visible:border-ring md:text-base"
        />
        <Pencil className="mr-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      {(dateLabel || groupLabel) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pt-0.5 pb-1 keyboard:hidden">
          {dateLabel && (
            <SummaryPill label="Data" value={dateLabel} icon={<CalendarDays />} onClick={onEditDate} />
          )}
          {groupLabel && (
            <SummaryPill label="Grupo" value={groupLabel} icon={<Users2 />} onClick={onEditGroup} />
          )}
        </div>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      onClick={onClick}
      className="relative inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 text-xs font-semibold text-foreground transition-colors outline-none after:absolute after:inset-x-0 after:-inset-y-1.5 hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
    >
      {icon}
      <span className="truncate">{value}</span>
    </button>
  );
}
