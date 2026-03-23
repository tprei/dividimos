"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CreditCard,
  Percent,
  Plus,
  QrCode,
  Receipt,
  ScanLine,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AddItemForm } from "@/components/bill/add-item-form";
import { AddParticipantForm } from "@/components/bill/add-participant-form";
import { BillSummary } from "@/components/bill/bill-summary";
import { BillTypeSelector } from "@/components/bill/bill-type-selector";
import { ItemCard } from "@/components/bill/item-card";
import { PayerStep } from "@/components/bill/payer-step";
import { PayerSummaryCard } from "@/components/bill/payer-summary-card";
import { SingleAmountStep } from "@/components/bill/single-amount-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { useBillStore } from "@/stores/bill-store";
import type { BillType, User } from "@/types";

type Step = "type" | "info" | "participants" | "items" | "split" | "amount-split" | "payer" | "summary";

interface StepDef {
  key: Step;
  label: string;
}

const ITEMIZED_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisao" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];

const SINGLE_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "amount-split", label: "Divisao" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];

const DEMO_USER: User = {
  id: "user_self",
  name: "Pedro Reis",
  phone: "+5511987654321",
  pixKey: "+5511987654321",
  pixKeyType: "phone",
  createdAt: new Date().toISOString(),
};

export default function NewBillPage() {
  const router = useRouter();
  const store = useBillStore();

  const [billType, setBillType] = useState<BillType | null>(null);
  const [step, setStep] = useState<Step>("type");
  const [title, setTitle] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [serviceFee, setServiceFee] = useState("10");
  const [fixedFees, setFixedFees] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);

  const steps = useMemo(
    () => (billType === "single_amount" ? SINGLE_STEPS : ITEMIZED_STEPS),
    [billType],
  );
  const stepIndex = steps.findIndex((s) => s.key === step);
  const isTypeStep = step === "type";

  const handleTypeSelect = (type: BillType) => {
    setBillType(type);
    setStep("info");
  };

  const initBill = useCallback(() => {
    if (!billType) return;
    store.setCurrentUser(DEMO_USER);
    store.createBill(title || "Nova conta", billType, merchantName || undefined);
    if (billType === "itemized") {
      store.updateBill({
        serviceFeePercent: parseFloat(serviceFee) || 0,
        fixedFees: Math.round((parseFloat(fixedFees.replace(",", ".")) || 0) * 100),
      });
    }
  }, [store, title, billType, merchantName, serviceFee, fixedFees]);

  const goNext = () => {
    if (step === "info") {
      initBill();
    }
    if (step === "summary") {
      store.computeLedger();
      router.push(`/app/bill/${store.bill?.id || "demo"}`);
      return;
    }
    const next = steps[stepIndex + 1];
    if (next) setStep(next.key);
  };

  const goBack = () => {
    if (stepIndex === 0) {
      setStep("type");
      setBillType(null);
      return;
    }
    const prev = steps[stepIndex - 1];
    if (prev) setStep(prev.key);
  };

  const handleAssign = (itemId: string, userId: string) => {
    const existingSplits = store.splits.filter((s) => s.itemId === itemId);
    const allUserIds = [...existingSplits.map((s) => s.userId), userId];
    store.splitItemEqually(itemId, allUserIds);
  };

  const handleUnassign = (itemId: string, userId: string) => {
    store.unassignItem(itemId, userId);
    const remaining = store.splits
      .filter((s) => s.itemId === itemId && s.userId !== userId)
      .map((s) => s.userId);
    if (remaining.length > 0) {
      store.splitItemEqually(itemId, remaining);
    }
  };

  const handleAssignAll = (itemId: string) => {
    const currentSplits = store.splits.filter((s) => s.itemId === itemId);
    const allAssigned = currentSplits.length === store.participants.length;
    if (allAssigned) {
      for (const p of store.participants) {
        store.unassignItem(itemId, p.id);
      }
    } else {
      store.splitItemEqually(itemId, store.participants.map((p) => p.id));
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        {!isTypeStep && stepIndex > 0 ? (
          <button
            onClick={goBack}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : !isTypeStep ? (
          <button
            onClick={() => { setStep("type"); setBillType(null); }}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </Link>
        )}
        <div className="flex-1">
          <h1 className="font-semibold">Nova conta</h1>
          {!isTypeStep && (
            <p className="text-xs text-muted-foreground">
              Passo {stepIndex + 1} de {steps.length}
            </p>
          )}
        </div>
      </div>

      {!isTypeStep && (
        <div className="mt-4">
          <div className="flex gap-1">
            {steps.map((s, idx) => (
              <div key={s.key} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: idx <= stepIndex ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  style={{ transformOrigin: "left" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 hidden sm:flex">
            {steps.map((s, idx) => (
              <span
                key={s.key}
                className={`flex-1 text-center text-[10px] font-medium transition-colors ${
                  idx <= stepIndex ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 min-h-[400px]">
        <AnimatePresence mode="wait">
          {step === "type" && (
            <motion.div
              key="type"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <BillTypeSelector onSelect={handleTypeSelect} />
            </motion.div>
          )}

          {step === "info" && (
            <motion.div
              key="info"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Nome da conta
                </label>
                <Input
                  placeholder={
                    billType === "single_amount"
                      ? "Ex: Airbnb, Uber, presente..."
                      : "Ex: Churrascaria, Bar do Zeca..."
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>

              {billType === "itemized" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Estabelecimento (opcional)
                    </label>
                    <Input
                      placeholder="Nome do restaurante"
                      value={merchantName}
                      onChange={(e) => setMerchantName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">
                        Taxa de servico (%)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={serviceFee}
                        onChange={(e) => setServiceFee(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">
                        Couvert / taxas fixas (R$)
                      </label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={fixedFees}
                        onChange={(e) => setFixedFees(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                        <Camera className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Escanear nota fiscal</p>
                        <p className="text-xs text-muted-foreground">
                          QR Code NFC-e ou foto do cupom
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" className="mt-3 w-full gap-2" onClick={() => {}}>
                      <ScanLine className="h-4 w-4" />
                      Escanear
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {step === "participants" && (
            <motion.div
              key="participants"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Adicione quem participou. Voce ja esta incluido.
              </p>
              <div className="space-y-2">
                {store.participants.map((user) => (
                  <motion.div key={user.id} layout className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      {user.name.charAt(0)}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{user.name}</p>
                      {user.phone && <p className="text-xs text-muted-foreground">{user.phone}</p>}
                    </div>
                    {user.id === DEMO_USER.id ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Voce</span>
                    ) : (
                      <button onClick={() => store.removeParticipant(user.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>
              <AnimatePresence>
                {showAddParticipant && (
                  <AddParticipantForm
                    onAdd={(user) => { store.addParticipant(user); setShowAddParticipant(false); }}
                    onCancel={() => setShowAddParticipant(false)}
                  />
                )}
              </AnimatePresence>
              {!showAddParticipant && (
                <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddParticipant(true)}>
                  <UserPlus className="h-4 w-4" />
                  Adicionar pessoa
                </Button>
              )}
            </motion.div>
          )}

          {step === "items" && (
            <motion.div
              key="items"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Adicione os itens da conta.{" "}
                {store.items.length > 0 && (
                  <span className="font-medium text-foreground">
                    {store.items.length} itens — {formatBRL(store.bill?.totalAmount || 0)}
                  </span>
                )}
              </p>
              <AnimatePresence>
                {store.items.map((item) => (
                  <motion.div key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} className="flex items-center justify-between rounded-xl border bg-card p-3">
                    <div>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity}x {formatBRL(item.unitPriceCents)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-sm">{formatBRL(item.totalPriceCents)}</span>
                      <button onClick={() => store.removeItem(item.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <AnimatePresence>
                {showAddItem && (
                  <AddItemForm onAdd={(item) => { store.addItem(item); setShowAddItem(false); }} onCancel={() => setShowAddItem(false)} />
                )}
              </AnimatePresence>
              {!showAddItem && (
                <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddItem(true)}>
                  <Plus className="h-4 w-4" />
                  Adicionar item
                </Button>
              )}
            </motion.div>
          )}

          {step === "split" && (
            <motion.div
              key="split"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Toque nos nomes para atribuir itens. Compartilhados sao divididos igualmente.
              </p>
              <AnimatePresence>
                {store.items.map((item) => {
                  const itemSplits = store.splits
                    .filter((s) => s.itemId === item.id)
                    .map((s) => ({ ...s, user: store.participants.find((p) => p.id === s.userId) }));
                  return (
                    <ItemCard key={item.id} item={item} splits={itemSplits} participants={store.participants} onAssign={handleAssign} onUnassign={handleUnassign} onAssignAll={handleAssignAll} onRemove={(id) => store.removeItem(id)} />
                  );
                })}
              </AnimatePresence>
              {store.items.length > 0 && (() => {
                const unassignedItems = store.items.filter((item) => store.splits.filter((s) => s.itemId === item.id).length === 0);
                if (unassignedItems.length === 0) return null;
                return (
                  <Button variant="outline" className="w-full gap-2 border-dashed border-primary/40 text-primary" onClick={() => { const allUserIds = store.participants.map((p) => p.id); for (const item of unassignedItems) { store.splitItemEqually(item.id, allUserIds); } }}>
                    <Users className="h-4 w-4" />
                    Dividir {unassignedItems.length} restante{unassignedItems.length > 1 ? "s" : ""} igualmente
                  </Button>
                );
              })()}
              {store.items.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <Receipt className="mx-auto h-8 w-8 opacity-50" />
                  <p className="mt-2 text-sm">Adicione itens primeiro</p>
                </div>
              )}
            </motion.div>
          )}

          {step === "amount-split" && (
            <motion.div
              key="amount-split"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <SingleAmountStep
                participants={store.participants}
                totalAmountInput={store.bill?.totalAmountInput || 0}
                onSetTotal={(cents) => store.updateBill({ totalAmountInput: cents, totalAmount: cents })}
                onSplitEqually={(ids) => store.splitBillEqually(ids)}
                onSplitByPercentage={(a) => store.splitBillByPercentage(a)}
                onSplitByFixed={(a) => store.splitBillByFixed(a)}
              />
            </motion.div>
          )}

          {step === "payer" && (
            <motion.div
              key="payer"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <PayerStep
                participants={store.participants}
                payers={store.bill?.payers || []}
                grandTotal={store.getGrandTotal()}
                onSetPayerFull={(id) => store.setPayerFull(id)}
                onSplitPaymentEqually={(ids) => store.splitPaymentEqually(ids)}
                onSetPayerAmount={(id, amt) => store.setPayerAmount(id, amt)}
                onRemovePayerEntry={(id) => store.removePayerEntry(id)}
              />
            </motion.div>
          )}

          {step === "summary" && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {store.bill && (
                <>
                  <BillSummary
                    bill={store.bill}
                    items={store.items}
                    splits={store.splits}
                    participants={store.participants}
                  />
                  {store.bill.payers.length > 0 && (
                    <PayerSummaryCard
                      payers={store.bill.payers}
                      participants={store.participants}
                    />
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isTypeStep && (
        <div className="mt-6 flex gap-3">
          <Button variant="outline" onClick={goBack} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <Button
            onClick={goNext}
            className="flex-1 gap-2"
            disabled={step === "info" && !title.trim()}
          >
            {step === "summary" ? (
              <>
                <QrCode className="h-4 w-4" />
                Gerar cobrancas Pix
              </>
            ) : (
              <>
                Proximo
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
