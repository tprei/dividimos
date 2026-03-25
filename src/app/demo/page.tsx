"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  QrCode,
  Receipt,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BillSummary } from "@/components/bill/bill-summary";
import { Logo } from "@/components/shared/logo";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { SimplificationToggle } from "@/components/settlement/simplification-toggle";
import { SimplificationViewer } from "@/components/settlement/simplification-viewer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/currency";
import { DEMO_ITEMS, DEMO_PIX_KEYS, DEMO_USERS } from "@/lib/demo-data";
import { springs } from "@/lib/animations";
import { computeRawEdges, simplifyDebts } from "@/lib/simplify";
import { coerceDebtStatus } from "@/lib/type-guards";
import type { Bill, BillItem, DebtStatus, ItemSplit, LedgerEntry } from "@/types";

const BILL_ID = "demo_bill";

function buildDemoData() {
  const now = new Date().toISOString();

  const bill: Bill = {
    id: BILL_ID,
    creatorId: "user_self",
    billType: "itemized",
    title: "Churrascaria Fogo de Chao",
    merchantName: "Fogo de Chao - Jardins",
    status: "active",
    serviceFeePercent: 10,
    fixedFees: 0,
    totalAmount: 0,
    totalAmountInput: 0,
    payers: [],
    createdAt: now,
    updatedAt: now,
  };

  const items: BillItem[] = DEMO_ITEMS.map((item, idx) => ({
    ...item,
    id: `item_${idx}`,
    billId: BILL_ID,
    createdAt: now,
  }));

  const splitAssignments: [number, string[]][] = [
    [0, ["user_self", "user_ana"]],
    [1, ["user_marcos", "user_julia"]],
    [2, ["user_self"]],
    [3, ["user_ana", "user_marcos", "user_julia"]],
    [4, ["user_self", "user_ana", "user_marcos", "user_julia"]],
    [5, ["user_self", "user_marcos"]],
    [6, ["user_self", "user_ana", "user_marcos", "user_julia"]],
    [7, ["user_julia"]],
  ];

  let splitIdCounter = 0;
  const splits: ItemSplit[] = [];
  for (const [itemIdx, userIds] of splitAssignments) {
    const item = items[itemIdx];
    const perPerson = Math.floor(item.totalPriceCents / userIds.length);
    const remainder = item.totalPriceCents - perPerson * userIds.length;
    for (let i = 0; i < userIds.length; i++) {
      splits.push({
        id: `split_${splitIdCounter++}`,
        itemId: item.id,
        userId: userIds[i],
        splitType: "equal",
        value: 100 / userIds.length,
        computedAmountCents: perPerson + (i < remainder ? 1 : 0),
      });
    }
  }

  const itemsTotal = items.reduce((s, i) => s + i.totalPriceCents, 0);
  const serviceFee = Math.round((itemsTotal * 10) / 100);
  const grandTotal = itemsTotal + serviceFee;

  const billedWithPayer: Bill = {
    ...bill,
    totalAmount: grandTotal,
    totalAmountInput: grandTotal,
    payers: [{ userId: "user_self", amountCents: grandTotal }],
  };

  const consumption = new Map<string, number>();
  for (const p of DEMO_USERS) consumption.set(p.id, 0);
  for (const split of splits) {
    consumption.set(split.userId, (consumption.get(split.userId) || 0) + split.computedAmountCents);
  }
  for (const [userId, itemTotal] of consumption) {
    const fee = Math.round((itemTotal / itemsTotal) * serviceFee);
    consumption.set(userId, (consumption.get(userId) || 0) + fee);
  }

  const payment = new Map<string, number>();
  for (const p of DEMO_USERS) payment.set(p.id, 0);
  payment.set("user_self", grandTotal);

  const netBalance = new Map<string, number>();
  for (const p of DEMO_USERS) {
    netBalance.set(p.id, (payment.get(p.id) || 0) - (consumption.get(p.id) || 0));
  }

  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];
  for (const [id, balance] of netBalance) {
    if (balance < -1) debtors.push({ id, amount: Math.abs(balance) });
    if (balance > 1) creditors.push({ id, amount: balance });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const ledger: LedgerEntry[] = [];
  let di = 0;
  let ci = 0;
  let entryId = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer <= 0) break;
    ledger.push({
      id: `ledger_${entryId++}`,
      billId: BILL_ID,
      fromUserId: debtors[di].id,
      toUserId: creditors[ci].id,
      amountCents: transfer,
      status: "pending",
      createdAt: now,
    });
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 1) di++;
    if (creditors[ci].amount <= 1) ci++;
  }

  return { bill: billedWithPayer, items, splits, ledger, grandTotal };
}

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<"items" | "split" | "payment">("payment");
  const [simplifyEnabled, setSimplifyEnabled] = useState(true);
  const [showSimplifySteps, setShowSimplifySteps] = useState(false);
  const [debtStatuses, setDebtStatuses] = useState<Map<string, DebtStatus>>(new Map());
  const [pixModal, setPixModal] = useState<{
    open: boolean;
    entryId: string;
    pixKey: string;
    name: string;
    amount: number;
  }>({
    open: false,
    entryId: "",
    pixKey: "",
    name: "",
    amount: 0,
  });

  const { bill, items, splits, ledger, grandTotal } = useMemo(() => buildDemoData(), []);

  const simplificationResult = useMemo(() => {
    const rawEdges = computeRawEdges(bill, DEMO_USERS, splits, [], items);
    if (rawEdges.length < 2) return null;
    return simplifyDebts(rawEdges, DEMO_USERS);
  }, [bill, splits, items]);

  const ledgerWithStatus = useMemo(
    () =>
      ledger.map((e) => ({
        ...e,
        status: debtStatuses.get(e.id) ?? e.status,
      })),
    [ledger, debtStatuses],
  );

  function markPaid(entryId: string) {
    setDebtStatuses((prev) => {
      const next = new Map(prev);
      next.set(entryId, "paid_unconfirmed");
      return next;
    });
  }

  function confirmPayment(entryId: string) {
    setDebtStatuses((prev) => {
      const next = new Map(prev);
      next.set(entryId, "settled");
      return next;
    });
  }

  const displayEntries = useMemo(() => {
    if (simplifyEnabled && simplificationResult) {
      return simplificationResult.simplifiedEdges.map((edge, idx) => ({
        id: `edge_${idx}`,
        billId: BILL_ID,
        fromUserId: edge.fromUserId,
        toUserId: edge.toUserId,
        amountCents: edge.amountCents,
        status: coerceDebtStatus(debtStatuses.get(`edge_${idx}`), "pending"),
        createdAt: new Date().toISOString(),
      }));
    }
    return ledgerWithStatus;
  }, [simplifyEnabled, simplificationResult, ledgerWithStatus, debtStatuses]);

  const allSettled = displayEntries.length > 0 && displayEntries.every((e) => e.status === "settled");
  const pendingCount = displayEntries.filter((e) => e.status !== "settled").length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <Logo size="sm" />
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              Demo
            </span>
          </div>
          <Link href="/auth">
            <Button size="sm" variant="outline">
              Criar conta
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 space-y-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
            <p className="text-sm text-white/70">Total da conta</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{formatBRL(grandTotal)}</p>
            <div className="mt-2 flex gap-4 text-sm text-white/70">
              <span className="flex items-center gap-1">
                <Receipt className="h-3.5 w-3.5" />
                {items.length} itens
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {DEMO_USERS.length} pessoas
              </span>
              <span className="flex items-center gap-1 text-white/50 text-xs italic">
                Fogo de Chao - Jardins
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35 }}
        >
          <div className="flex rounded-xl bg-muted/50 p-1">
            {(
              [
                { key: "items", label: "Itens" },
                { key: "split", label: "Divisao" },
                { key: "payment", label: "Pagamento" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
                  activeTab === tab.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {tab.key === "payment" && pendingCount > 0 && !allSettled && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {activeTab === "items" && (
            <motion.div
              key="items-tab"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-2"
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity > 1 ? `${item.quantity}x ` : ""}
                      {formatBRL(item.unitPriceCents)}/un
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatBRL(item.totalPriceCents)}
                  </span>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === "split" && (
            <motion.div
              key="split-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <BillSummary
                bill={bill}
                items={items}
                splits={splits}
                participants={DEMO_USERS}
              />
            </motion.div>
          )}

          {activeTab === "payment" && (
            <motion.div
              key="payment-tab"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.05, duration: 0.3 }}
              className="space-y-4"
            >
              {allSettled ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="flex flex-col items-center rounded-2xl border-2 border-dashed border-success/30 bg-success/5 p-8"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
                    <CheckCheck className="h-8 w-8 text-success" />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">Tudo liquidado!</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Todos os pagamentos foram confirmados.
                  </p>
                </motion.div>
              ) : (
                <>
                  {simplificationResult && (
                    <SimplificationToggle
                      originalCount={simplificationResult.originalCount}
                      simplifiedCount={simplificationResult.simplifiedCount}
                      enabled={simplifyEnabled}
                      onToggle={setSimplifyEnabled}
                      onViewSteps={() => setShowSimplifySteps(true)}
                    />
                  )}

                  <div>
                    <h2 className="mb-3 text-sm font-semibold">
                      Cobrancas
                      {simplificationResult && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {simplifyEnabled
                            ? `(${simplificationResult.simplifiedCount} simplificadas)`
                            : `(${simplificationResult.originalCount} detalhadas)`}
                        </span>
                      )}
                    </h2>

                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {displayEntries.map((entry, idx) => {
                          const payer = DEMO_USERS.find((p) => p.id === entry.fromUserId);
                          const receiver = DEMO_USERS.find((p) => p.id === entry.toUserId);

                          return (
                            <motion.div
                              key={entry.id}
                              layout
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.06 }}
                              className="overflow-hidden rounded-2xl border bg-card"
                            >
                              <div className="p-4">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                                      {payer?.name.charAt(0) || "?"}
                                    </div>
                                    <div>
                                      <p className="text-sm font-medium">
                                        {payer?.name.split(" ")[0] || "?"}{" "}
                                        <span className="text-muted-foreground">→</span>{" "}
                                        {receiver?.name.split(" ")[0] || "?"}
                                      </p>
                                      <motion.span
                                        key={entry.status}
                                        initial={{ scale: 0.8, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={springs.snappy}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                          entry.status === "pending"
                                            ? "bg-warning/15 text-warning-foreground"
                                            : entry.status === "paid_unconfirmed"
                                              ? "bg-primary/15 text-primary"
                                              : "bg-success/15 text-success"
                                        }`}
                                      >
                                        {entry.status === "pending" && (
                                          <>
                                            <Clock className="h-3 w-3" />
                                            Pendente
                                          </>
                                        )}
                                        {entry.status === "paid_unconfirmed" && (
                                          <>
                                            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                            Aguardando confirmacao
                                          </>
                                        )}
                                        {entry.status === "settled" && (
                                          <>
                                            <CheckCheck className="h-3 w-3" />
                                            Liquidado
                                          </>
                                        )}
                                      </motion.span>
                                    </div>
                                  </div>
                                  <motion.p
                                    key={entry.amountCents}
                                    initial={{ y: 6, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    className="text-lg font-bold tabular-nums"
                                  >
                                    {formatBRL(entry.amountCents)}
                                  </motion.p>
                                </div>

                                <AnimatePresence mode="wait">
                                  {entry.status === "pending" && (
                                    <motion.div
                                      key="pending-actions"
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="mt-3 flex gap-2"
                                    >
                                      <Button
                                        size="sm"
                                        className="flex-1 gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                                        onClick={() =>
                                          setPixModal({
                                            open: true,
                                            entryId: entry.id,
                                            pixKey: DEMO_PIX_KEYS[entry.toUserId] || "",
                                            name: receiver?.name || "",
                                            amount: entry.amountCents,
                                          })
                                        }
                                      >
                                        <QrCode className="h-4 w-4" />
                                        Pagar via Pix
                                      </Button>
                                    </motion.div>
                                  )}

                                  {entry.status === "paid_unconfirmed" && (
                                    <motion.div
                                      key="confirm-actions"
                                      initial={{ opacity: 0, scale: 0.98 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.98 }}
                                      transition={{ duration: 0.2 }}
                                      className="mt-3"
                                    >
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full gap-1.5 border-success/30 text-success hover:bg-success/10"
                                        onClick={() => confirmPayment(entry.id)}
                                      >
                                        <Check className="h-4 w-4" />
                                        Confirmar recebimento
                                      </Button>
                                    </motion.div>
                                  )}

                                  {entry.status === "settled" && (
                                    <motion.div
                                      key="settled-info"
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      className="mt-3 flex items-center gap-2 rounded-lg bg-success/5 px-3 py-2"
                                    >
                                      <CheckCheck className="h-4 w-4 shrink-0 text-success" />
                                      <span className="text-xs text-success">Liquidado</span>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="rounded-3xl gradient-primary p-8 text-white text-center shadow-xl shadow-primary/20"
        >
          <h2 className="text-xl font-bold">Pronto para dividir com seus amigos?</h2>
          <p className="mt-2 text-sm text-white/80">
            Crie sua conta e comece a dividir contas sem estresse.
          </p>
          <Link href="/auth">
            <Button
              size="lg"
              variant="secondary"
              className="mt-5 gap-2 font-semibold"
            >
              Criar conta
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
        </motion.div>
      </main>

      <PixQrModal
        open={pixModal.open}
        onClose={() => setPixModal({ ...pixModal, open: false })}
        pixKey={pixModal.pixKey}
        recipientName={pixModal.name}
        amountCents={pixModal.amount}
        onMarkPaid={() => {
          markPaid(pixModal.entryId);
          setPixModal({ ...pixModal, open: false });
        }}
      />

      {simplificationResult && (
        <Sheet open={showSimplifySteps} onOpenChange={setShowSimplifySteps}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
            <SheetHeader>
              <SheetTitle>Simplificacao passo a passo</SheetTitle>
            </SheetHeader>
            <div className="mt-4 pb-8">
              <SimplificationViewer
                result={simplificationResult}
                participants={DEMO_USERS}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
