"use client";

import { useState } from "react";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectionMark } from "@/components/ui/selection-mark";
import { haptics } from "@/hooks/use-haptics";
import { formatBRL } from "@/lib/currency";
import { parseAllocationPercentText } from "@/lib/expense-money";
import { percentText } from "@/lib/item-division";
import type { SplitMode } from "./use-split-draft";

export interface SplitPerson {
  id: string;
  /** Already disambiguated display label. */
  label: string;
  /** Full name for accessible labels. */
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface SplitEditorProps {
  /** Names the group of rows for assistive tech, e.g. "Quem consumiu". */
  label: string;
  people: readonly SplitPerson[];
  mode: SplitMode;
  onModeChange: (mode: SplitMode) => void;
  included: readonly string[];
  onToggle: (id: string) => void;
  basisPointsById: Readonly<Record<string, number>>;
  centsById: Readonly<Record<string, number>>;
  onShareChange: (id: string, value: number) => void;
  /** Shown only while someone's share was typed by hand. */
  onSplitEvenly: (() => void) | null;
  /** Text when nobody is included, e.g. "Escolha quem pagou." */
  emptyText: string;
  /** Verb for accessible labels: "consumiu" / "pagou". */
  shareVerb: string;
  /** Total minus what the shares add up to; shown only when nonzero. */
  remainderCents: number;
}

const MODE_OPTIONS = [
  { value: "equal", label: "Igual" },
  { value: "percent", label: "%" },
  { value: "fixed", label: "Valores" },
] as const;

function percentLabel(basisPoints: number): string {
  return basisPoints % 100 === 0 ? String(basisPoints / 100) : percentText(basisPoints);
}

function PercentInput({
  basisPoints,
  onChange,
  label,
}: {
  basisPoints: number;
  onChange: (basisPoints: number) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [committed, setCommitted] = useState(basisPoints);
  const [seen, setSeen] = useState(basisPoints);
  if (basisPoints !== seen) {
    setSeen(basisPoints);
    if (basisPoints !== committed) setText(null);
  }
  const invalid = text !== null && text !== "" && !parseAllocationPercentText(text).ok;

  return (
    <label className="flex h-10 w-[4.75rem] shrink-0 items-center gap-1 rounded-[0.5rem] border border-input bg-background px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={text ?? percentLabel(basisPoints)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const parsed = raw === "" ? { ok: true as const, value: 0 } : parseAllocationPercentText(raw);
          if (!parsed.ok) return;
          setCommitted(parsed.value);
          onChange(parsed.value);
        }}
        onBlur={() => setText(null)}
        className="w-full min-w-0 bg-transparent text-right text-base leading-6 tabular-nums outline-none md:text-sm"
      />
      <span aria-hidden="true" className="text-base leading-6 text-muted-foreground md:text-sm">%</span>
    </label>
  );
}

export function SplitEditor({
  label,
  people,
  mode,
  onModeChange,
  included,
  onToggle,
  basisPointsById,
  centsById,
  onShareChange,
  onSplitEvenly,
  emptyText,
  shareVerb,
  remainderCents,
}: SplitEditorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SegmentedControl
          aria-label={`Como dividir: ${label}`}
          value={mode}
          options={MODE_OPTIONS}
          onChange={(value) => {
            const next = MODE_OPTIONS.find((option) => option.value === value);
            if (next) onModeChange(next.value);
          }}
          className="flex-1"
        />
        {onSplitEvenly && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { haptics.selectionChanged(); onSplitEvenly(); }}>
            Dividir igual
          </Button>
        )}
      </div>
      <ul aria-label={label} className="divide-y divide-border overflow-hidden rounded-[0.75rem] border border-border bg-card">
        {people.map((person) => {
          const selected = included.includes(person.id);
          const cents = centsById[person.id] ?? 0;
          return (
            <li key={person.id} className="flex min-h-12 items-center gap-2 pr-2">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  haptics.selectionChanged();
                  onToggle(person.id);
                }}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 pl-3 text-left outline-none focus-visible:bg-muted/60"
              >
                <SelectionMark selected={selected} />
                {person.isGuest ? (
                  <GuestAvatar id={person.id} name={person.name} size="sm" />
                ) : (
                  <UserAvatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                )}
                <span className="min-w-0 truncate text-sm font-semibold" title={person.name}>
                  {person.label}
                </span>
              </button>
              {selected && mode === "equal" && (
                <Money cents={cents} className="shrink-0 text-sm" />
              )}
              {selected && mode === "percent" && (
                <>
                  <span className="hidden w-[4.5rem] shrink-0 text-right text-xs text-muted-foreground tabular-nums min-[380px]:inline">
                    {formatBRL(cents)}
                  </span>
                  <PercentInput
                    basisPoints={basisPointsById[person.id] ?? 0}
                    onChange={(value) => onShareChange(person.id, value)}
                    label={`Percentual que ${person.name} ${shareVerb}`}
                  />
                </>
              )}
              {selected && mode === "fixed" && (
                <label className="flex h-10 w-[7.5rem] shrink-0 items-center gap-1 rounded-[0.5rem] border border-input bg-background px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span aria-hidden="true" className="text-base leading-6 text-muted-foreground md:text-sm">R$</span>
                  <CurrencyInput
                    valueCents={cents}
                    onChangeCents={(value) => onShareChange(person.id, value)}
                    aria-label={`Valor que ${person.name} ${shareVerb}`}
                    className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-right focus-visible:ring-0"
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {included.length === 0 ? (
        <p role="status" className="px-1 text-xs text-muted-foreground">{emptyText}</p>
      ) : remainderCents !== 0 ? (
        <p role="status" className="px-1 text-xs font-semibold text-destructive-text">
          {remainderCents > 0 ? `Faltam ${formatBRL(remainderCents)}` : `Sobram ${formatBRL(-remainderCents)}`}
        </p>
      ) : null}
    </div>
  );
}
