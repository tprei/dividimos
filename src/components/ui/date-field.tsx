"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { buildDateShortcuts, friendlyDateLabel, toIsoDate } from "@/lib/date-shortcuts";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  max?: string;
  min?: string;
  /**
   * "subtle": a text-sized trigger that reads "Hoje", "Ontem" or the day.
   * "chip": a pill that sits beside date shortcuts; it reads "Outro dia"
   * while a shortcut holds the value, and fills with the day otherwise.
   */
  variant?: "field" | "subtle" | "chip";
}

const TRIGGER_CLASSES = {
  field:
    "flex h-11 w-full min-w-0 items-center rounded-[0.5rem] border border-input bg-card px-3 text-left text-base tabular-nums transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 md:text-sm",
  subtle:
    "relative inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[0.5rem] px-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:inset-x-0 [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:h-11 [@media(pointer:coarse)]:after:-translate-y-1/2",
  chip: "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:active:scale-100",
} as const;

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const WEEKDAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

const WEEKDAY_NAMES = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

interface CalendarView {
  year: number;
  month: number;
}

interface IsoDate {
  year: number;
  month: number;
  day: number;
}

interface DayCell {
  iso: string;
  dayNumber: number;
  disabled: boolean;
  /** Day of the month before or after the one on view, shown muted. */
  adjacent: boolean;
}

function parseIso(value: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function shiftIso(value: string, days: number): string {
  const parts = parseIso(value);
  if (!parts) return value;
  return toIsoDate(new Date(parts.year, parts.month, parts.day + days));
}

function initialView(value: string): CalendarView {
  const parts = parseIso(value);
  if (parts) return { year: parts.year, month: parts.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function shiftView(view: CalendarView, months: number): CalendarView {
  const date = new Date(view.year, view.month + months, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function daysInMonth(view: CalendarView): number {
  return new Date(view.year, view.month + 1, 0).getDate();
}

function inView(iso: string, view: CalendarView): boolean {
  const parts = parseIso(iso);
  if (!parts) return false;
  return parts.year === view.year && parts.month === view.month;
}

// Always six week rows: a month that fits in four must not make the dialog
// shorter, or the month arrows jump between taps.
function buildWeeks(
  view: CalendarView,
  isDayDisabled: (iso: string) => boolean,
): Array<Array<DayCell>> {
  const start = new Date(view.year, view.month, 1 - new Date(view.year, view.month, 1).getDay());
  const weeks: Array<Array<DayCell>> = [];
  for (let week = 0; week < 6; week += 1) {
    const row: DayCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
      const iso = toIsoDate(date);
      row.push({
        iso,
        dayNumber: date.getDate(),
        disabled: isDayDisabled(iso),
        adjacent: date.getMonth() !== view.month,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

function monthHasEnabledDay(
  view: CalendarView,
  isDayDisabled: (iso: string) => boolean,
): boolean {
  for (let day = 1; day <= daysInMonth(view); day += 1) {
    if (!isDayDisabled(toIsoDate(new Date(view.year, view.month, day)))) return true;
  }
  return false;
}

/** One visual state per day: fill beats the today ring beats the mutes. */
function dayCellClass(state: {
  selected: boolean;
  isToday: boolean;
  adjacent: boolean;
  weekend: boolean;
}): string {
  if (state.selected) return "bg-primary font-bold text-primary-foreground hover:bg-primary/80";
  if (state.isToday) return "ring-2 ring-primary text-primary-text";
  if (state.adjacent) return "text-muted-foreground/50";
  if (state.weekend) return "text-muted-foreground";
  return "text-foreground";
}

export function DateField(props: DateFieldProps): React.JSX.Element {
  const { label, value, onChange, id, max, min, variant = "field" } = props;
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<CalendarView>(() => initialView(value));
  const [focusRequest, setFocusRequest] = React.useState<{ iso: string; seq: number } | null>(null);
  const [monthDirection, setMonthDirection] = React.useState(1);
  const reduceMotion = useReducedMotion();
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const seqRef = React.useRef(0);
  const titleId = React.useId();

  const today = toIsoDate(new Date());
  const isDayDisabled = (iso: string) =>
    (min !== undefined && iso < min) || (max !== undefined && iso > max);
  const shortcuts = buildDateShortcuts(today).filter((shortcut) => !isDayDisabled(shortcut.iso));

  const focusIsoFor = (targetView: CalendarView): string | null => {
    if (!isDayDisabled(value) && inView(value, targetView)) return value;
    if (!isDayDisabled(today) && inView(today, targetView)) return today;
    for (const week of buildWeeks(targetView, isDayDisabled)) {
      for (const cell of week) {
        if (!cell.disabled && !cell.adjacent) return cell.iso;
      }
    }
    return null;
  };

  const weeks = buildWeeks(view, isDayDisabled);
  const rovingIso = focusRequest?.iso ?? focusIsoFor(view);
  const canGoPrev = monthHasEnabledDay(shiftView(view, -1), isDayDisabled);
  const canGoNext = monthHasEnabledDay(shiftView(view, 1), isDayDisabled);

  const requestFocus = (iso: string) => {
    seqRef.current += 1;
    setFocusRequest({ iso, seq: seqRef.current });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      const targetView = initialView(value);
      setView(targetView);
      const target = focusIsoFor(targetView);
      if (target) requestFocus(target);
    }
  };

  const shiftMonth = (months: number) => {
    const targetView = shiftView(view, months);
    setMonthDirection(months >= 0 ? 1 : -1);
    setView(targetView);
    const target = focusIsoFor(targetView);
    if (target) requestFocus(target);
  };

  const pick = (iso: string) => {
    haptics.selectionChanged();
    onChange(iso);
    setOpen(false);
  };

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const startIso = focusRequest?.iso ?? focusIsoFor(view) ?? today;
    let cursor = startIso;
    let next: string | null = null;
    for (let step = 0; step < 366; step += 1) {
      cursor = shiftIso(cursor, delta);
      if (!isDayDisabled(cursor)) {
        next = cursor;
        break;
      }
    }
    if (!next) return;
    // Six rows always span three months, so a day already on screen must not flip the page.
    const onGrid = next >= weeks[0][0].iso && next <= weeks[5][6].iso;
    if (!onGrid) {
      setMonthDirection(delta >= 0 ? 1 : -1);
      setView(initialView(next));
    }
    requestFocus(next);
  };

  React.useEffect(() => {
    if (!open || !focusRequest) return;
    const monthGrid = gridRef.current?.querySelector<HTMLElement>(
      `[data-month="${view.year}-${view.month}"]`,
    );
    const button = monthGrid?.querySelector<HTMLButtonElement>(`[data-iso="${focusRequest.iso}"]`);
    button?.focus();
  }, [open, focusRequest, view]);

  const parts = parseIso(value);
  const displayValue = parts
    ? `${String(parts.day).padStart(2, "0")}/${String(parts.month + 1).padStart(2, "0")}/${String(parts.year).padStart(4, "0")}`
    : value;
  const onShortcut = shortcuts.some((shortcut) => shortcut.iso === value);
  let triggerText = friendlyDateLabel(value, today);
  if (variant === "field") triggerText = displayValue;
  else if (variant === "chip" && onShortcut) triggerText = "Outro dia";

  const monthKey = `${view.year}-${view.month}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        id={id}
        data-slot="date-field-trigger"
        aria-label={label}
        className={cn(
          TRIGGER_CLASSES[variant],
          variant === "chip" &&
            (onShortcut
              ? "border-dashed border-border bg-card text-foreground hover:border-primary/50"
              : "border-primary bg-primary text-primary-foreground"),
        )}
      >
        {variant !== "field" && <CalendarDays className="size-4 shrink-0" aria-hidden="true" />}
        {triggerText}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        initialFocus={() =>
          gridRef.current?.querySelector<HTMLButtonElement>('[data-iso][tabindex="0"]') ?? true
        }
        className="w-82 max-w-[calc(100%-1rem)] gap-0 overflow-hidden p-0"
      >
        <div className="gradient-mesh border-b border-primary/20 bg-primary/15 px-1 pt-1 pb-3 dark:bg-primary/10">
          <div className="flex items-center justify-between gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Mês anterior"
              disabled={!canGoPrev}
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft />
            </Button>
            <DialogTitle
              id={titleId}
              className="flex-1 text-center text-base font-bold first-letter:uppercase"
            >
              {MONTH_NAMES[view.month]} de {view.year}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Próximo mês"
              disabled={!canGoNext}
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div role="group" aria-label="Atalhos de data" className="flex gap-1.5 px-1.5 pt-1">
            {shortcuts.map((shortcut) => (
              <ChoiceChip
                key={shortcut.label}
                size="sm"
                selected={shortcut.iso === value}
                onClick={() => pick(shortcut.iso)}
                className="flex-auto"
              >
                {shortcut.label}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <div ref={gridRef} role="grid" aria-labelledby={titleId} className="p-2">
          <div role="row" className="grid grid-cols-7">
            {WEEKDAY_LETTERS.map((letter, index) => (
              <div
                key={letter + String(index)}
                role="columnheader"
                aria-label={WEEKDAY_NAMES[index]}
                className={cn(
                  "flex h-7 items-center justify-center text-xs font-semibold",
                  index === 0 || index === 6 ? "text-primary-text/70" : "text-muted-foreground",
                )}
              >
                {letter}
              </div>
            ))}
          </div>
          <motion.div
            key={monthKey}
            data-month={monthKey}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 * monthDirection }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {weeks.map((week) => (
              <div key={week[0].iso} role="row" className="grid grid-cols-7">
                {week.map((cell, dayIndex) => {
                  const cellDate = parseIso(cell.iso);
                  const isWeekend = dayIndex === 0 || dayIndex === 6;
                  const selected = cell.iso === value;
                  return (
                    <div
                      key={cell.iso}
                      role="gridcell"
                      aria-selected={selected}
                      className="flex justify-center"
                    >
                      <button
                        type="button"
                        data-iso={cell.iso}
                        tabIndex={cell.iso === rovingIso ? 0 : -1}
                        aria-label={
                          cellDate
                            ? `${cell.dayNumber} de ${MONTH_NAMES[cellDate.month]} de ${cellDate.year}`
                            : cell.iso
                        }
                        aria-current={cell.iso === today ? "date" : undefined}
                        disabled={cell.disabled}
                        onClick={() => pick(cell.iso)}
                        onKeyDown={handleGridKeyDown}
                        className={cn(
                          "inline-flex h-11 w-full min-w-11 items-center justify-center rounded-xl text-sm font-semibold transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
                          dayCellClass({ selected, isToday: cell.iso === today, adjacent: cell.adjacent, weekend: isWeekend }),
                        )}
                      >
                        {cell.dayNumber}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
