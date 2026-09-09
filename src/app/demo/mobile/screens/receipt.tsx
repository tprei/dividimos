"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseExpenseCentsText } from "@/lib/expense-money";

import {
  GUEST_MARIA,
  ITEMIZED_PARTICIPANT_IDS,
  ITEMS,
  RECEIPT_DATE_BR,
  SERVICE_FEE_CENTS,
  firstName,
  personById,
} from "../fixtures";
import type { ItemFixture } from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { GuestAvatar } from "../ui/guest-avatar";
import { ItemDivision, divisionForItem, equalDivision, recomputeDivisionShares } from "../ui/item-division";
import type { ItemDivisionValue } from "../ui/item-division";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";

const ROW = "flex min-h-14 items-center gap-3 px-4 py-2";
const NAME_INPUT = "h-9 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0";
const AMOUNT_INPUT =
  "h-9 w-24 border-0 bg-transparent px-0 text-right font-mono shadow-none focus-visible:ring-0";
const CHECKBOX = "size-5 accent-primary";
const FOOTER_BUTTON = "h-12 w-full text-base font-bold";
const ITEMIZED_PATH = "/demo/mobile/bill-itemized";

function initialExpandedId(sheet: string | null, section: string | null): string | null {
  if (section === "expanded") return "i_picanha";
  if (sheet !== "item") return null;
  const pending = ITEMS.find((item) => item.assigneeIds.length === 0);
  return (pending ?? ITEMS[0]).id;
}

function centavosToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function participantLabel(id: string): string {
  return id === GUEST_MARIA.id ? GUEST_MARIA.name : firstName(personById(id));
}

function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function ParticipantAvatar({ id, className }: { id: string; className?: string }) {
  if (id === GUEST_MARIA.id) return <GuestAvatar size="xs" className={className} />;
  return <UserAvatar name={personById(id).name} size="xs" className={className} />;
}

export function ReceiptScreen({ sheet, section }: ScreenProps) {
  const router = useRouter();
  const [items, setItems] = useState<ItemFixture[]>(() =>
    ITEMS.map((item) => ({ ...item, assigneeIds: [...item.assigneeIds] })),
  );
  const [divisions, setDivisions] = useState<Record<string, ItemDivisionValue>>({});
  const [nameValues, setNameValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ITEMS.map((item) => [item.id, item.name])),
  );
  const [amountValues, setAmountValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ITEMS.map((item) => [item.id, centavosToInput(item.cents)])),
  );
  const [expandedId, setExpandedId] = useState<string | null>(() => initialExpandedId(sheet, section));
  const [batchOpen, setBatchOpen] = useState(sheet === "batch");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(section === "selected" ? ITEMS.slice(0, 2).map((item) => item.id) : []),
  );
  const [batchIds, setBatchIds] = useState<Set<string>>(() => new Set(ITEMIZED_PARTICIPANT_IDS));

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

  const applyBatch = () => {
    const ids = [...batchIds];
    setItems((prev) => prev.map((item) => (checkedIds.has(item.id) ? { ...item, assigneeIds: ids } : item)));
    setDivisions((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!checkedIds.has(item.id) || ids.length === 0) continue;
        const division = equalDivision(ids, item.cents);
        if (division) next[item.id] = division;
      }
      return next;
    });
    setBatchOpen(false);
  };

  const pendingCount = items.filter((item) => !divisionForItem(item, divisions)).length;
  const totalCents = items.reduce((sum, item) => sum + item.cents, 0) + SERVICE_FEE_CENTS;

  return (
    <PreviewShell nav={null}>
      <ScreenHeader back eyebrow="Leitura" title="Recibo" />
      <div className="px-4">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="h-1 bg-primary" />
          <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Recibo lido</p>
              <p className="text-base font-bold">Mercado do bairro</p>
              <p className="font-mono text-xs text-muted-foreground">{RECEIPT_DATE_BR}</p>
            </div>
            <Badge variant="secondary">{pendingCount} {pendingCount === 1 ? "pendente" : "pendentes"}</Badge>
          </div>
          <div className="divide-y divide-border border-t">
            {items.map((item) => {
              const expanded = expandedId === item.id;
              return (
                <Fragment key={item.id}>
                  <div className={ROW}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      aria-label={`Selecionar ${item.name}`}
                      checked={checkedIds.has(item.id)}
                      onChange={() => setCheckedIds((prev) => toggleId(prev, item.id))}
                    />
                    <Input
                      value={nameValues[item.id] ?? ""}
                      onChange={(event) => changeItemName(item.id, event.target.value)}
                      aria-label={`Nome de ${item.name}`}
                      className={NAME_INPUT}
                    />
                    <Input
                      value={amountValues[item.id] ?? ""}
                      onChange={(event) => changeItemAmount(item.id, event.target.value)}
                      inputMode="decimal"
                      aria-label={`Valor de ${item.name}`}
                      className={AMOUNT_INPUT}
                    />
                    {item.assigneeIds.length > 0 ? (
                      <div className="flex -space-x-1.5">
                        {item.assigneeIds.map((id) => (
                          <ParticipantAvatar key={id} id={id} className="ring-2 ring-card" />
                        ))}
                      </div>
                    ) : (
                      <Badge variant="secondary">Pendente</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Dividir ${item.name}`}
                      aria-expanded={expanded}
                      onClick={() => toggleItem(item.id)}
                    >
                      <Users className="size-4" />
                    </Button>
                  </div>
                  {expanded && (
                    <div className="px-4 pb-4 pt-1">
                      <ItemDivision
                        item={item}
                        value={divisions[item.id]}
                        onSave={saveDivision(item.id)}
                        onCancel={() => setExpandedId(null)}
                      />
                    </div>
                  )}
                </Fragment>
              );
            })}
            <div className={ROW}>
              <p className="flex-1 text-sm">Taxa de serviço</p>
              <Input
                defaultValue={centavosToInput(SERVICE_FEE_CENTS)}
                inputMode="decimal"
                aria-label="Valor da taxa"
                className={AMOUNT_INPUT}
              />
            </div>
            <div className="flex min-h-14 items-center justify-between px-4 py-2">
              <p className="text-sm font-bold">Total</p>
              <Money cents={totalCents} className="font-bold" />
            </div>
          </div>
        </div>
      </div>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        {checkedIds.size === 0 ? (
          <Button size="lg" className={FOOTER_BUTTON} onClick={() => router.push(ITEMIZED_PATH)}>
            Continuar para divisão
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" className="h-12" onClick={() => setCheckedIds(new Set())}>
              Limpar
            </Button>
            <Button size="lg" className="h-12 flex-1 text-base font-bold" onClick={() => setBatchOpen(true)}>
              Atribuir · {checkedIds.size}
            </Button>
          </div>
        )}
      </footer>
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir itens</DialogTitle>
            <DialogDescription>
              {checkedIds.size} {checkedIds.size === 1 ? "item selecionado" : "itens selecionados"} na leitura do recibo.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border rounded-2xl border bg-card">
            {ITEMIZED_PARTICIPANT_IDS.map((id) => (
              <label key={id} className={ROW}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={batchIds.has(id)}
                  onChange={() => setBatchIds((prev) => toggleId(prev, id))}
                  aria-label={`Atribuir a ${participantLabel(id)}`}
                />
                <ParticipantAvatar id={id} />
                <span className="text-sm font-semibold">{participantLabel(id)}</span>
              </label>
            ))}
          </div>
          <Button size="lg" className={FOOTER_BUTTON} disabled={batchIds.size === 0} onClick={applyBatch}>
            Aplicar em {checkedIds.size} {checkedIds.size === 1 ? "item" : "itens"}
          </Button>
        </DialogContent>
      </Dialog>
    </PreviewShell>
  );
}
