"use client";

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { firstName, personById, SINGLE_BILL } from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { Money } from "../ui/money";
import { PreviewShell } from "../preview-shell";
import { ScreenHeader } from "../ui/screen-header";
import { SectionHeading } from "../ui/section-heading";

const SPLIT_MODES = [
  { id: "equal", label: "Igual" },
  { id: "percent", label: "Percentual" },
  { id: "fixed", label: "Fixo" },
] as const;

type SplitMode = (typeof SPLIT_MODES)[number]["id"];

function initialMode(section: string | null): SplitMode {
  if (section === "percent" || section === "percent-error") return "percent";
  if (section === "fixed") return "fixed";
  return "equal";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}

function chipClassName(selected: boolean): string {
  return cn(
    "flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold",
    selected
      ? "border-primary/40 bg-primary/15 text-primary"
      : "border-border bg-card text-foreground",
  );
}

export function BillSingleScreen({ section }: ScreenProps) {
  const [mode, setMode] = useState<SplitMode>(initialMode(section));
  const [payerId, setPayerId] = useState<string>(SINGLE_BILL.payerId);
  const showPercentError = mode === "percent" && section === "percent-error";

  return (
    <PreviewShell nav={null}>
      <ScreenHeader back eyebrow="Valor único" title="Nova conta" />
      <div className="px-4 pb-2">
        <Money cents={SINGLE_BILL.totalCents} className="text-4xl font-semibold" />
      </div>
      <div className="space-y-5 px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <Input defaultValue={SINGLE_BILL.title} className="h-11 rounded-xl" />
          </Field>
          <Field label="Data">
            <Input type="date" defaultValue={SINGLE_BILL.dateIso} className="h-11 rounded-xl" />
          </Field>
        </div>
        <Field label="Grupo">
          <div className="relative">
            <Input readOnly value={SINGLE_BILL.group} className="h-11 rounded-xl pr-9" />
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </Field>
        <div className="space-y-2">
          <p className="text-xs font-bold">Quem pagou</p>
          <div className="flex flex-wrap gap-2">
            {SINGLE_BILL.participantIds.map((id) => {
              const person = personById(id);
              const selected = id === payerId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPayerId(id)}
                  className={chipClassName(selected)}
                >
                  <UserAvatar name={person.name} size="xs" />
                  {firstName(person)}
                </button>
              );
            })}
          </div>
        </div>
        <Button variant="outline" className="h-11 w-full justify-between rounded-xl px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4" />
            Participantes
          </span>
          <Badge variant="secondary">{SINGLE_BILL.participantIds.length}</Badge>
        </Button>
        <div>
          <SectionHeading
            title="Divisão"
            trailing={
              <div className="flex gap-1.5">
                {SPLIT_MODES.map((option) => {
                  const selected = option.id === mode;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setMode(option.id)}
                      className={chipClassName(selected)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <section className="rounded-2xl border bg-card">
            <div key={mode} className="divide-y divide-border">
              {SINGLE_BILL.participantIds.map((id) => {
                const person = personById(id);
                const name = firstName(person);
                const percentShare = showPercentError ? (id === SINGLE_BILL.payerId ? "39,99" : "20,00") : undefined;
                return (
                  <div key={id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <UserAvatar name={person.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold">{name}</span>
                    {mode !== "equal" && (
                      <Input
                        inputMode="decimal"
                        defaultValue={percentShare}
                        placeholder="0,00"
                        aria-label={mode === "percent" ? `Porcentagem de ${name}` : `Valor de ${name}`}
                        className="h-9 w-24 rounded-lg text-right font-mono"
                      />
                    )}
                    {mode === "equal" ? (
                      <Money cents={SINGLE_BILL.equalShareCents} className="text-sm" />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {showPercentError && (
            <p className="pt-2 text-xs font-semibold text-destructive" aria-live="polite">
              falta 0,01%
            </p>
          )}
        </div>
      </div>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button size="lg" className="h-12 w-full text-base font-bold">
          Criar conta
        </Button>
      </footer>
    </PreviewShell>
  );
}
