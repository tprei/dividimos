"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import type { GroupSelectProps } from "@/components/bill/group-select";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { SelectionMark } from "@/components/ui/selection-mark";
import { buildDateShortcuts, toIsoDate } from "@/lib/date-shortcuts";
import { cn } from "@/lib/utils";

const QUESTION_CLASS = "px-1 text-xl leading-7 font-bold tracking-tight";

export function TitleQuestion({
  title,
  onTitleChange,
  titleRef,
  onConfirm,
}: {
  title: string;
  onTitleChange: (title: string) => void;
  titleRef?: RefObject<HTMLInputElement | null>;
  onConfirm: () => void;
}) {
  const ready = title.trim().length > 0;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onConfirm();
      }}
    >
      <h2 className={QUESTION_CLASS}>Do que é a conta?</h2>
      <div className="flex gap-2">
        <Input
          id="expense-title"
          ref={titleRef}
          aria-label="Nome da conta"
          placeholder="Ex.: Pizza de sexta"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          autoFocus
          autoComplete="off"
          enterKeyHint="next"
          className="h-12 min-w-0 flex-1 text-base md:text-base"
        />
        <Button type="submit" size="lg" className="h-12 px-5 font-bold" disabled={!ready}>
          OK
        </Button>
      </div>
    </form>
  );
}

export function DateQuestion({
  value,
  onPick,
  onSkip,
}: {
  value: string;
  onPick: (iso: string) => void;
  onSkip: () => void;
}) {
  const shortcuts = buildDateShortcuts(toIsoDate(new Date()));
  return (
    <section className="space-y-3">
      <h2 className={QUESTION_CLASS}>Quando foi?</h2>
      <div className="flex flex-wrap gap-2">
        {shortcuts.map((shortcut) => (
          <ChoiceChip
            key={shortcut.label}
            selected={shortcut.iso === value}
            onClick={() => onPick(shortcut.iso)}
          >
            {shortcut.label}
          </ChoiceChip>
        ))}
        <DateField label="Escolher outra data" variant="chip" value={value} onChange={onPick} />
      </div>
      <SkipButton onSkip={onSkip} />
    </section>
  );
}

export function GroupQuestion({
  group,
  groupsPending = false,
  onPick,
  onSkip,
}: {
  group: GroupSelectProps;
  groupsPending?: boolean;
  onPick: () => void;
  onSkip: () => void;
}) {
  const [naming, setNaming] = useState(group.value === "create");
  const choose = (value: string) => {
    group.onSelect(value);
    group.onToggleCreateGroup(value === "create");
  };
  return (
    <section className="space-y-3">
      <h2 className={QUESTION_CLASS}>De qual grupo?</h2>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {group.groups.map((snapshot) => (
          <GroupRow
            key={snapshot.group.id}
            selected={group.value === snapshot.group.id}
            onClick={() => {
              choose(snapshot.group.id);
              onPick();
            }}
            avatar={
              <GroupAvatar
                name={snapshot.group.name}
                avatar={snapshot.overview?.avatar}
                groupId={snapshot.group.id}
                size="sm"
              />
            }
            title={snapshot.group.name}
            detail={`${snapshot.members.length} ${snapshot.members.length === 1 ? "pessoa" : "pessoas"}`}
          />
        ))}
        {group.groups.length === 0 && groupsPending && (
          <div role="status" className="flex min-h-14 items-center gap-3 px-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            Carregando grupos…
          </div>
        )}
        {group.dmEligible && (
          <GroupRow
            selected={group.value === "dm"}
            onClick={() => {
              choose("dm");
              onPick();
            }}
            avatar={<RowIcon><MessageCircle /></RowIcon>}
            title="Conversa direta"
            detail="Fica na conversa de vocês dois"
          />
        )}
        {naming ? (
          <form
            className="flex items-center gap-2 p-2 pl-3"
            onSubmit={(event) => {
              event.preventDefault();
              onPick();
            }}
          >
            <RowIcon dashed><Plus /></RowIcon>
            <Input
              aria-label="Nome do grupo"
              placeholder={group.createFallback?.trim() || "Nome do novo grupo"}
              value={group.createValue}
              onChange={(event) => group.onCreateValueChange(event.target.value)}
              autoFocus
              autoComplete="off"
              enterKeyHint="next"
              className="h-11 min-w-0 flex-1"
            />
            <Button type="submit" size="lg" className="font-bold">
              OK
            </Button>
          </form>
        ) : (
          <GroupRow
            onClick={() => {
              choose("create");
              setNaming(true);
            }}
            avatar={<RowIcon dashed><Plus /></RowIcon>}
            title="Novo grupo"
            detail="Com quem você escolher a seguir"
          />
        )}
      </div>
      <SkipButton onSkip={onSkip} />
    </section>
  );
}

function GroupRow({
  selected,
  onClick,
  avatar,
  title,
  detail,
}: {
  /** Undefined for an action row that opens something instead of picking. */
  selected?: boolean;
  onClick: () => void;
  avatar: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/60 active:bg-muted/60"
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {selected !== undefined && <SelectionMark selected={selected} />}
    </button>
  );
}

function RowIcon({ dashed = false, children }: { dashed?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground [&>svg]:size-4",
        dashed ? "border border-dashed border-muted-foreground/50" : "bg-muted",
      )}
    >
      {children}
    </span>
  );
}

function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="flex justify-end">
      <Button type="button" variant="ghost" size="lg" className="text-muted-foreground" onClick={onSkip}>
        Pular
      </Button>
    </div>
  );
}
