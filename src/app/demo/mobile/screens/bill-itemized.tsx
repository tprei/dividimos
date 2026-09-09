"use client";

import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronDown, Plus, Trash2, Users } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { allocateByWeights, parseExpenseCentsText } from "@/lib/expense-money";
import { cn } from "@/lib/utils";

import {
  GUEST_MARIA,
  ITEMIZED_PARTICIPANT_IDS,
  ITEMS,
  ME,
  SERVICE_FEE_CENTS,
  firstName,
  personById,
} from "../fixtures";
import type { ItemFixture } from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { GuestAvatar } from "../ui/guest-avatar";
import { ItemDivision, divisionForItem, recomputeDivisionShares } from "../ui/item-division";
import type { ItemDivisionValue } from "../ui/item-division";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";
import { SectionHeading } from "../ui/section-heading";

type SectionKey = "items" | "split" | "payment" | "review";

const SECTION_TABS: { key: SectionKey; label: string }[] = [
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisão" },
  { key: "payment", label: "Pagamento" },
  { key: "review", label: "Revisão" },
];

const SECTION_ORDER: SectionKey[] = ["items", "split", "payment", "review"];

const BORDERLESS = "h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0";

function isSectionKey(section: string | null): section is SectionKey {
  return section === "items" || section === "split" || section === "payment" || section === "review";
}

function initialExpandedId(sheet: string | null): string | null {
  if (sheet !== "item") return null;
  const pending = ITEMS.find((item) => item.assigneeIds.length === 0);
  return (pending ?? ITEMS[0]).id;
}

function isGuest(id: string): boolean {
  return id === GUEST_MARIA.id;
}

function displayName(id: string): string {
  return isGuest(id) ? GUEST_MARIA.name : firstName(personById(id));
}

function amountText(cents: number): string {
  return `${Math.floor(cents / 100)},${(cents % 100).toString().padStart(2, "0")}`;
}

function perPersonBreakdown(items: ItemFixture[], divisions: Record<string, ItemDivisionValue>) {
  const totals: Record<string, number> = {};
  for (const id of ITEMIZED_PARTICIPANT_IDS) totals[id] = 0;
  let assignedCount = 0;
  let pendingCents = SERVICE_FEE_CENTS;
  for (const item of items) {
    const division = divisionForItem(item, divisions);
    if (!division) {
      pendingCents += item.cents;
      continue;
    }
    assignedCount += 1;
    for (const share of division.shares) totals[share.participantId] += share.cents;
  }
  const partial = assignedCount < items.length;
  if (!partial) {
    const fees = allocateByWeights(SERVICE_FEE_CENTS, ITEMIZED_PARTICIPANT_IDS.map((id) => totals[id]));
    if (fees.ok) {
      ITEMIZED_PARTICIPANT_IDS.forEach((id, index) => {
        totals[id] += fees.value[index];
      });
    }
  }
  return { totals, partial, pendingCents };
}

function ParticipantAvatar({ id, className }: { id: string; className?: string }) {
  if (isGuest(id)) return <GuestAvatar size="xs" className={className} />;
  const person = personById(id);
  return <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="xs" className={className} />;
}

function Chip({ pressed, onClick, disabled, children }: { pressed: boolean; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} aria-disabled={disabled || undefined} onClick={onClick} className={cn("flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-semibold", pressed ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-foreground")}>
      {children}
    </button>
  );
}

function AssigneeStack({ ids }: { ids: string[] }) {
  return <span className="flex -space-x-1.5">{ids.map((id) => <ParticipantAvatar key={id} id={id} className="ring-2 ring-card" />)}</span>;
}

function ParticipantChips({ selectedIds, onToggle, disableGuests }: { selectedIds: string[]; onToggle: (id: string) => void; disableGuests?: boolean }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {ITEMIZED_PARTICIPANT_IDS.map((id) => (
        <Chip key={id} pressed={selectedIds.includes(id)} disabled={disableGuests && isGuest(id)} onClick={() => onToggle(id)}>
          <ParticipantAvatar id={id} />
          {displayName(id)}
        </Chip>
      ))}
    </div>
  );
}

function PayerCard({ name, amountCents }: { name: string; amountCents: number }) {
  return <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border bg-card px-4"><span className="text-sm font-semibold">{name}</span><Money cents={amountCents} className="text-sm" /></div>;
}

function AmountInput({ value, label }: { value: number; label: string }) {
  return <Input defaultValue={amountText(value)} inputMode="decimal" aria-label={label} className={cn(BORDERLESS, "w-24 text-right font-mono")} />;
}

function ItemsCard({
  items,
  nameValues,
  amountValues,
  onNameChange,
  onAmountChange,
  editing,
  totalCents,
  expandedId,
  onToggleItem,
  expansionFor,
}: {
  items: ItemFixture[];
  nameValues?: Record<string, string>;
  amountValues?: Record<string, string>;
  onNameChange?: (itemId: string, name: string) => void;
  onAmountChange?: (itemId: string, text: string) => void;
  editing?: boolean;
  totalCents: number;
  expandedId?: string | null;
  onToggleItem?: (itemId: string) => void;
  expansionFor?: (item: ItemFixture) => ReactNode;
}) {
  return (
    <div className="divide-y divide-border rounded-2xl border bg-card">
      {items.map((item) => {
        const body = editing ? (
          <>
            <Input
              value={nameValues?.[item.id] ?? ""}
              onChange={(event) => onNameChange?.(item.id, event.target.value)}
              aria-label={`Nome do item ${item.name}`}
              className={BORDERLESS}
            />
            <Input
              value={amountValues?.[item.id] ?? ""}
              onChange={(event) => onAmountChange?.(item.id, event.target.value)}
              inputMode="decimal"
              aria-label={`Valor de ${item.name}`}
              className={cn(BORDERLESS, "w-24 text-right font-mono")}
            />
            <Button variant="ghost" size="icon-sm" aria-label={`Remover ${item.name}`}><Trash2 className="size-4" /></Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
            <Money cents={item.cents} className="text-sm" />
            {item.assigneeIds.length > 0 ? <AssigneeStack ids={item.assigneeIds} /> : <Badge variant="secondary">Pendente</Badge>}
          </>
        );
        const expanded = !editing && expandedId === item.id;
        const rowClass = editing ? "flex min-h-14 items-center gap-2 px-4 py-2" : "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left";
        return (
          <Fragment key={item.id}>
            {onToggleItem && !editing ? (
              <button type="button" onClick={() => onToggleItem(item.id)} aria-expanded={expanded} className={rowClass}>
                {body}
              </button>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
            {expanded && expansionFor ? expansionFor(item) : null}
          </Fragment>
        );
      })}
      <div className="flex min-h-14 items-center gap-2 px-4 py-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">Taxa de serviço</span>
        {editing ? <AmountInput value={SERVICE_FEE_CENTS} label="Valor da taxa de serviço" /> : <Money cents={SERVICE_FEE_CENTS} className="text-sm" />}
      </div>
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
        <span className="text-sm font-bold">Total</span>
        <Money cents={totalCents} className="text-sm font-bold" />
      </div>
    </div>
  );
}

export function BillItemizedScreen({ sheet, section }: ScreenProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>(isSectionKey(section) ? section : "split");
  const [items, setItems] = useState<ItemFixture[]>(() =>
    ITEMS.map((item) => ({ ...item, assigneeIds: [...item.assigneeIds] })),
  );
  const [divisions, setDivisions] = useState<Record<string, ItemDivisionValue>>({});
  const [nameValues, setNameValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ITEMS.map((item) => [item.id, item.name])),
  );
  const [amountValues, setAmountValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ITEMS.map((item) => [item.id, amountText(item.cents)])),
  );
  const [expandedId, setExpandedId] = useState<string | null>(() => initialExpandedId(sheet));
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [payerId, setPayerId] = useState(ME.id);

  const toggleItem = (itemId: string) => setExpandedId((current) => (current === itemId ? null : itemId));

  const saveDivision = (itemId: string) => (value: ItemDivisionValue) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, assigneeIds: value.shares.map((share) => share.participantId) } : item,
      ),
    );
    setDivisions((prev) => ({ ...prev, [itemId]: value }));
    setExpandedId(null);
  };

  const changeItemName = (itemId: string, name: string) => {
    setNameValues((prev) => ({ ...prev, [itemId]: name }));
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, name } : item)));
  };

  const changeItemAmount = (itemId: string, text: string) => {
    setAmountValues((prev) => ({ ...prev, [itemId]: text }));
    const parsed = parseExpenseCentsText(text, { format: "plain_decimal", zeroPolicy: "allow" });
    if (!parsed.ok) return;
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, cents: parsed.value } : item)));
    setDivisions((prev) => {
      const division = prev[itemId];
      if (!division) return prev;
      return { ...prev, [itemId]: recomputeDivisionShares(division, parsed.value) };
    });
  };

  const advanceSection = () =>
    setActiveSection((current) => SECTION_ORDER[Math.min(SECTION_ORDER.indexOf(current) + 1, SECTION_ORDER.length - 1)]);

  const pendingItems = items.filter((item) => !divisionForItem(item, divisions));
  const breakdown = perPersonBreakdown(items, divisions);
  const grandTotalCents = items.reduce((sum, item) => sum + item.cents, 0) + SERVICE_FEE_CENTS;

  const expansionFor = (item: ItemFixture) => (
    <div className="px-4 pb-4 pt-1">
      <ItemDivision item={item} value={divisions[item.id]} onSave={saveDivision(item.id)} onCancel={() => setExpandedId(null)} />
    </div>
  );

  return (
    <PreviewShell nav={null}>
      <ScreenHeader back eyebrow="Nova conta" title="Conta detalhada" />
      <div className="grid grid-cols-[1fr_auto] gap-2 px-4">
        <Input defaultValue="Churras do Ap 42" className="h-11 rounded-xl" aria-label="Nome da conta" />
        <div className="relative w-40">
          <Input readOnly value="Churras do Ap 42" aria-label="Grupo" className="h-11 rounded-xl pr-9" />
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-background px-4">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveSection(tab.key)}
            aria-current={activeSection === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
              activeSection === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeSection === "items" && (
        <div className="space-y-3 px-4 py-3">
          <ItemsCard
            items={items}
            editing
            nameValues={nameValues}
            amountValues={amountValues}
            onNameChange={changeItemName}
            onAmountChange={changeItemAmount}
            totalCents={grandTotalCents}
          />
          <Button variant="ghost" className="h-10 w-full"><Plus className="size-4" />Adicionar item</Button>
        </div>
      )}
      {activeSection === "split" && (
        <div className="space-y-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setParticipantsOpen((open) => !open)}
            aria-expanded={participantsOpen}
            className="flex h-10 w-full items-center justify-between rounded-xl border bg-card px-4 text-sm font-semibold"
          >
            <span className="flex items-center gap-2"><Users className="size-4" />Participantes</span>
            <span className="flex items-center gap-2">
              <Badge variant="secondary">{ITEMIZED_PARTICIPANT_IDS.length}</Badge>
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", participantsOpen && "rotate-180")} />
            </span>
          </button>
          {participantsOpen && (
            <div className="divide-y divide-border rounded-2xl border bg-card">
              {ITEMIZED_PARTICIPANT_IDS.map((id) => (
                <div key={id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                  <ParticipantAvatar id={id} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName(id)}</span>
                </div>
              ))}
            </div>
          )}
          <ItemsCard
            items={items}
            totalCents={grandTotalCents}
            expandedId={expandedId}
            onToggleItem={toggleItem}
            expansionFor={expansionFor}
          />
        </div>
      )}
      {activeSection === "payment" && (
        <div className="space-y-3 px-4 py-3">
          <SectionHeading title="Quem pagou" />
          <ParticipantChips selectedIds={[payerId]} onToggle={setPayerId} disableGuests />
          <PayerCard name={displayName(payerId)} amountCents={grandTotalCents} />
        </div>
      )}
      {activeSection === "review" && (
        <div className="space-y-3 px-4 py-3">
          {pendingItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveSection("split");
                setExpandedId(item.id);
              }}
              className="flex w-full items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-left text-sm"
            >
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1">{item.name}: divisão pendente</span>
              <span className="text-xs font-bold text-primary">Resolver</span>
            </button>
          ))}
          <SectionHeading title="Itens" />
          <ItemsCard items={items} totalCents={grandTotalCents} />
          <SectionHeading title="Por pessoa" trailing={breakdown.partial ? "Parcial" : undefined} />
          <div className="divide-y divide-border rounded-2xl border bg-card">
            {ITEMIZED_PARTICIPANT_IDS.map((id) => (
              <div key={id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                <ParticipantAvatar id={id} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName(id)}</span>
                <Money cents={breakdown.totals[id]} className="text-sm" />
              </div>
            ))}
          </div>
          {breakdown.partial && (
            <p className="px-1 text-xs font-semibold text-muted-foreground">
              A distribuir: {formatBRL(breakdown.pendingCents)} (itens pendentes + taxa de serviço).
            </p>
          )}
          <SectionHeading title="Pagamento" />
          <PayerCard name={displayName(payerId)} amountCents={grandTotalCents} />
        </div>
      )}
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button size="lg" className="h-12 w-full text-base font-bold" onClick={advanceSection} disabled={activeSection === "review"}>
          {activeSection === "review" ? "Criar conta" : "Continuar"}
        </Button>
      </footer>
    </PreviewShell>
  );
}
