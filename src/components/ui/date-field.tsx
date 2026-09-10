"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

export interface DateFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  id?: string
  max?: string
  min?: string
}

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
] as const

const WEEKDAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"] as const

const WEEKDAY_NAMES = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const

interface CalendarView {
  year: number
  month: number
}

interface IsoDate {
  year: number
  month: number
  day: number
}

interface DayCell {
  iso: string
  dayNumber: number
  disabled: boolean
}

function parseIso(value: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

function toIso(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function shiftIso(value: string, days: number): string {
  const parts = parseIso(value)
  if (!parts) return value
  return toIso(new Date(parts.year, parts.month, parts.day + days))
}

function initialView(value: string): CalendarView {
  const parts = parseIso(value)
  if (parts) return { year: parts.year, month: parts.month }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function shiftView(view: CalendarView, months: number): CalendarView {
  const date = new Date(view.year, view.month + months, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

function daysInMonth(view: CalendarView): number {
  return new Date(view.year, view.month + 1, 0).getDate()
}

function inView(iso: string, view: CalendarView): boolean {
  const parts = parseIso(iso)
  if (!parts) return false
  return parts.year === view.year && parts.month === view.month
}

function buildWeeks(
  view: CalendarView,
  isDayDisabled: (iso: string) => boolean,
): Array<Array<DayCell | null>> {
  const leadingBlanks = new Date(view.year, view.month, 1).getDay()
  const cells: Array<DayCell | null> = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 1; day <= daysInMonth(view); day += 1) {
    const iso = toIso(new Date(view.year, view.month, day))
    cells.push({ iso, dayNumber: day, disabled: isDayDisabled(iso) })
  }
  const weeks: Array<Array<DayCell | null>> = []
  for (let start = 0; start < cells.length; start += 7) {
    weeks.push(cells.slice(start, start + 7))
  }
  return weeks
}

function monthHasEnabledDay(
  view: CalendarView,
  isDayDisabled: (iso: string) => boolean,
): boolean {
  for (let day = 1; day <= daysInMonth(view); day += 1) {
    if (!isDayDisabled(toIso(new Date(view.year, view.month, day)))) return true
  }
  return false
}

export function DateField(props: DateFieldProps): React.JSX.Element {
  const { label, value, onChange, id, max, min } = props
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<CalendarView>(() => initialView(value))
  const [focusRequest, setFocusRequest] = React.useState<{ iso: string; seq: number } | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const seqRef = React.useRef(0)
  const titleId = React.useId()

  const today = toIso(new Date())
  const isDayDisabled = (iso: string) =>
    (min !== undefined && iso < min) || (max !== undefined && iso > max)

  const focusIsoFor = (targetView: CalendarView): string | null => {
    if (!isDayDisabled(value) && inView(value, targetView)) return value
    if (!isDayDisabled(today) && inView(today, targetView)) return today
    for (const week of buildWeeks(targetView, isDayDisabled)) {
      for (const cell of week) {
        if (cell && !cell.disabled) return cell.iso
      }
    }
    return null
  }

  const weeks = buildWeeks(view, isDayDisabled)
  const rovingIso = focusRequest?.iso ?? focusIsoFor(view)
  const canGoPrev = monthHasEnabledDay(shiftView(view, -1), isDayDisabled)
  const canGoNext = monthHasEnabledDay(shiftView(view, 1), isDayDisabled)

  const requestFocus = (iso: string) => {
    seqRef.current += 1
    setFocusRequest({ iso, seq: seqRef.current })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      const targetView = initialView(value)
      setView(targetView)
      const target = focusIsoFor(targetView)
      if (target) requestFocus(target)
    }
  }

  const shiftMonth = (months: number) => {
    const targetView = shiftView(view, months)
    setView(targetView)
    const target = focusIsoFor(targetView)
    if (target) requestFocus(target)
  }

  const pick = (iso: string) => {
    onChange(iso)
    setOpen(false)
  }

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const delta = deltas[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const startIso = focusRequest?.iso ?? focusIsoFor(view) ?? today
    let cursor = startIso
    let next: string | null = null
    for (let step = 0; step < 366; step += 1) {
      cursor = shiftIso(cursor, delta)
      if (!isDayDisabled(cursor)) {
        next = cursor
        break
      }
    }
    if (!next) return
    const targetView = initialView(next)
    if (targetView.year !== view.year || targetView.month !== view.month) {
      setView(targetView)
    }
    requestFocus(next)
  }

  React.useEffect(() => {
    if (!open || !focusRequest) return
    const button = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-iso="${focusRequest.iso}"]`,
    )
    button?.focus()
  }, [open, focusRequest])

  const parts = parseIso(value)
  const displayValue = parts
    ? `${String(parts.day).padStart(2, "0")}/${String(parts.month + 1).padStart(2, "0")}/${String(parts.year).padStart(4, "0")}`
    : value

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        id={id}
        data-slot="date-field-trigger"
        aria-label={label}
        className="flex h-11 w-full min-w-0 items-center rounded-lg border border-input bg-card px-3 text-left text-base font-medium tabular-nums transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
      >
        {displayValue}
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="w-auto gap-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mês anterior"
            disabled={!canGoPrev}
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <DialogTitle id={titleId} className="flex-1 text-center text-sm font-bold">
            {MONTH_NAMES[view.month]} de {view.year}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo mês"
            disabled={!canGoNext}
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div ref={gridRef} role="grid" aria-labelledby={titleId} className="space-y-1">
          <div role="row" className="grid grid-cols-7">
            {WEEKDAY_LETTERS.map((letter, index) => (
              <div
                key={letter + String(index)}
                role="columnheader"
                aria-label={WEEKDAY_NAMES[index]}
                className="flex size-9 items-center justify-center text-xs font-bold text-muted-foreground"
              >
                {letter}
              </div>
            ))}
          </div>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} role="row" className="grid grid-cols-7">
              {week.map((cell, dayIndex) =>
                cell ? (
                  <div
                    key={cell.iso}
                    role="gridcell"
                    aria-selected={cell.iso === value}
                    className="flex justify-center"
                  >
                    <button
                      type="button"
                      data-iso={cell.iso}
                      tabIndex={cell.iso === rovingIso ? 0 : -1}
                      aria-label={`${cell.dayNumber} de ${MONTH_NAMES[view.month]} de ${view.year}`}
                      aria-current={cell.iso === today ? "date" : undefined}
                      disabled={cell.disabled}
                      onClick={() => pick(cell.iso)}
                      onKeyDown={handleGridKeyDown}
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-lg text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                        cell.iso === value &&
                          "bg-primary text-primary-foreground hover:bg-primary/80",
                        cell.iso !== value &&
                          cell.iso === today &&
                          "border border-primary text-primary",
                      )}
                    >
                      {cell.dayNumber}
                    </button>
                  </div>
                ) : (
                  <div key={`${weekIndex}-${dayIndex}`} />
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDayDisabled(today)}
            onClick={() => pick(today)}
          >
            Hoje
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
