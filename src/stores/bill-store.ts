"use client";

"use client";

import { create } from "zustand";
import { distributeProportionally, distributeEvenly } from "@/lib/currency";
import type {
  Bill,
  BillItem,
  BillPayer,
  BillSplit,
  BillStatus,
  BillType,
  DebtStatus,
  ItemSplit,
  LedgerEntry,
  SplitType,
  User,
} from "@/types";

interface BillState {
  currentUser: User | null;
  bill: Bill | null;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  ledger: LedgerEntry[];

  setCurrentUser: (user: User) => void;

  createBill: (title: string, billType: BillType, merchantName?: string, groupId?: string) => void;
  updateBill: (updates: Partial<Bill>) => void;
  setBillType: (billType: BillType) => void;

  addParticipant: (user: User) => void;
  removeParticipant: (userId: string) => void;

  addItem: (item: Omit<BillItem, "id" | "billId" | "createdAt">) => void;
  updateItem: (itemId: string, updates: Partial<BillItem>) => void;
  removeItem: (itemId: string) => void;

  assignItem: (itemId: string, userId: string, splitType: SplitType, value: number) => void;
  unassignItem: (itemId: string, userId: string) => void;
  splitItemEqually: (itemId: string, userIds: string[]) => void;

  setPayerFull: (userId: string) => void;
  splitPaymentEqually: (userIds: string[]) => void;
  setPayerAmount: (userId: string, amountCents: number) => void;
  removePayerEntry: (userId: string) => void;

  splitBillEqually: (userIds: string[]) => void;
  splitBillByPercentage: (assignments: { userId: string; percentage: number }[]) => void;
  splitBillByFixed: (assignments: { userId: string; amountCents: number }[]) => void;

  getGrandTotal: () => number;
  computeLedger: () => void;
  recordPayment: (entryId: string, amountCents: number) => void;
  markPaid: (entryId: string) => void;
  getParticipantTotal: (userId: string) => number;
  reset: () => void;
}

let nextId = 1;
function generateId(): string {
  return `local_${Date.now()}_${nextId++}`;
}

export const useBillStore = create<BillState>((set, get) => ({
  currentUser: null,
  bill: null,
  participants: [],
  items: [],
  splits: [],
  billSplits: [],
  ledger: [],

  setCurrentUser: (user) => set({ currentUser: user }),

  createBill: (title, billType, merchantName, groupId) => {
    const bill: Bill = {
      id: generateId(),
      creatorId: get().currentUser?.id || "",
      billType,
      title,
      merchantName,
      status: "draft",
      serviceFeePercent: billType === "itemized" ? 10 : 0,
      fixedFees: 0,
      totalAmount: 0,
      totalAmountInput: 0,
      payers: [],
      groupId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const currentUser = get().currentUser;
    set({
      bill,
      participants: currentUser ? [currentUser] : [],
      items: [],
      splits: [],
      billSplits: [],
      ledger: [],
    });
  },

  updateBill: (updates) => {
    const bill = get().bill;
    if (!bill) return;
    set({ bill: { ...bill, ...updates, updatedAt: new Date().toISOString() } });
  },

  setBillType: (billType) => {
    const bill = get().bill;
    if (!bill) return;
    if (billType === "single_amount") {
      set({
        bill: { ...bill, billType, serviceFeePercent: 0, fixedFees: 0, updatedAt: new Date().toISOString() },
        items: [],
        splits: [],
      });
    } else {
      set({
        bill: { ...bill, billType, serviceFeePercent: 10, totalAmountInput: 0, updatedAt: new Date().toISOString() },
        billSplits: [],
      });
    }
  },

  addParticipant: (user) => {
    const existing = get().participants.find((p) => p.id === user.id);
    if (existing) return;
    set({ participants: [...get().participants, user] });
  },

  removeParticipant: (userId) => {
    set({
      participants: get().participants.filter((p) => p.id !== userId),
      splits: get().splits.filter((s) => s.userId !== userId),
      billSplits: get().billSplits.filter((s) => s.userId !== userId),
    });
  },

  addItem: (item) => {
    const billItem: BillItem = {
      ...item,
      id: generateId(),
      billId: get().bill?.id || "",
      createdAt: new Date().toISOString(),
    };
    set({ items: [...get().items, billItem] });
    recalcTotal(get, set);
  },

  updateItem: (itemId, updates) => {
    set({
      items: get().items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
    });
    recalcTotal(get, set);
  },

  removeItem: (itemId) => {
    set({
      items: get().items.filter((i) => i.id !== itemId),
      splits: get().splits.filter((s) => s.itemId !== itemId),
    });
    recalcTotal(get, set);
  },

  assignItem: (itemId, userId, splitType, value) => {
    const existing = get().splits.find(
      (s) => s.itemId === itemId && s.userId === userId,
    );
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;

    let computedAmountCents = 0;
    if (splitType === "fixed") {
      computedAmountCents = value;
    } else if (splitType === "percentage") {
      computedAmountCents = Math.round((item.totalPriceCents * value) / 100);
    }

    if (existing) {
      set({
        splits: get().splits.map((s) =>
          s.itemId === itemId && s.userId === userId
            ? { ...s, splitType, value, computedAmountCents }
            : s,
        ),
      });
    } else {
      const split: ItemSplit = {
        id: generateId(),
        itemId,
        userId,
        splitType,
        value,
        computedAmountCents,
      };
      set({ splits: [...get().splits, split] });
    }
  },

  unassignItem: (itemId, userId) => {
    set({
      splits: get().splits.filter(
        (s) => !(s.itemId === itemId && s.userId === userId),
      ),
    });
  },

  splitItemEqually: (itemId, userIds) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item || userIds.length === 0) return;

    const perPerson = Math.floor(item.totalPriceCents / userIds.length);
    const remainder = item.totalPriceCents - perPerson * userIds.length;

    const existingOther = get().splits.filter((s) => s.itemId !== itemId);
    const newSplits: ItemSplit[] = userIds.map((userId, idx) => ({
      id: generateId(),
      itemId,
      userId,
      splitType: "equal" as SplitType,
      value: 100 / userIds.length,
      computedAmountCents: perPerson + (idx < remainder ? 1 : 0),
    }));

    set({ splits: [...existingOther, ...newSplits] });
  },

  setPayerFull: (userId) => {
    const grandTotal = get().getGrandTotal();
    const bill = get().bill;
    if (!bill) return;
    set({
      bill: {
        ...bill,
        payers: [{ userId, amountCents: grandTotal }],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  splitPaymentEqually: (userIds) => {
    const grandTotal = get().getGrandTotal();
    const bill = get().bill;
    if (!bill || userIds.length === 0) return;
    const perPerson = Math.floor(grandTotal / userIds.length);
    const remainder = grandTotal - perPerson * userIds.length;
    const payers: BillPayer[] = userIds.map((userId, idx) => ({
      userId,
      amountCents: perPerson + (idx < remainder ? 1 : 0),
    }));
    set({
      bill: { ...bill, payers, updatedAt: new Date().toISOString() },
    });
  },

  setPayerAmount: (userId, amountCents) => {
    const bill = get().bill;
    if (!bill) return;
    const existing = bill.payers.find((p) => p.userId === userId);
    let payers: BillPayer[];
    if (existing) {
      payers = bill.payers.map((p) =>
        p.userId === userId ? { ...p, amountCents } : p,
      );
    } else {
      payers = [...bill.payers, { userId, amountCents }];
    }
    set({ bill: { ...bill, payers, updatedAt: new Date().toISOString() } });
  },

  removePayerEntry: (userId) => {
    const bill = get().bill;
    if (!bill) return;
    set({
      bill: {
        ...bill,
        payers: bill.payers.filter((p) => p.userId !== userId),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  splitBillEqually: (userIds) => {
    const bill = get().bill;
    if (!bill || userIds.length === 0) return;
    const total = bill.totalAmountInput;
    const perPerson = Math.floor(total / userIds.length);
    const remainder = total - perPerson * userIds.length;
    const billSplits: BillSplit[] = userIds.map((userId, idx) => ({
      userId,
      splitType: "equal" as SplitType,
      value: 100 / userIds.length,
      computedAmountCents: perPerson + (idx < remainder ? 1 : 0),
    }));
    set({ billSplits });
  },

  splitBillByPercentage: (assignments) => {
    const bill = get().bill;
    if (!bill) return;
    const total = bill.totalAmountInput;
    const billSplits: BillSplit[] = assignments.map((a) => ({
      userId: a.userId,
      splitType: "percentage" as SplitType,
      value: a.percentage,
      computedAmountCents: Math.round((total * a.percentage) / 100),
    }));
    set({ billSplits });
  },

  splitBillByFixed: (assignments) => {
    const billSplits: BillSplit[] = assignments.map((a) => ({
      userId: a.userId,
      splitType: "fixed" as SplitType,
      value: a.amountCents,
      computedAmountCents: a.amountCents,
    }));
    set({ billSplits });
  },

  getGrandTotal: () => {
    const { bill, items } = get();
    if (!bill) return 0;
    if (bill.billType === "single_amount") {
      return bill.totalAmountInput;
    }
    const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    return (
      itemsTotal +
      Math.round((itemsTotal * bill.serviceFeePercent) / 100) +
      bill.fixedFees
    );
  },

  computeLedger: () => {
    const { bill, participants, items, splits, billSplits } = get();
    if (!bill || participants.length === 0) return;

    const consumption = new Map<string, number>();
    const payment = new Map<string, number>();

    for (const p of participants) {
      consumption.set(p.id, 0);
      payment.set(p.id, 0);
    }

    if (bill.billType === "single_amount") {
      for (const bs of billSplits) {
        consumption.set(bs.userId, (consumption.get(bs.userId) || 0) + bs.computedAmountCents);
      }
    } else {
      const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
      for (const split of splits) {
        consumption.set(split.userId, (consumption.get(split.userId) || 0) + split.computedAmountCents);
      }
      if (bill.serviceFeePercent > 0 && itemsTotal > 0) {
        const totalServiceFee = Math.round((itemsTotal * bill.serviceFeePercent) / 100);
        const weights = participants.map((p) => consumption.get(p.id) || 0);
        const fees = distributeProportionally(totalServiceFee, weights);
        participants.forEach((p, i) => {
          consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
        });
      }
      if (bill.fixedFees > 0) {
        const fees = distributeEvenly(bill.fixedFees, participants.length);
        participants.forEach((p, i) => {
          consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
        });
      }
    }

    const payers = bill.payers.length > 0
      ? bill.payers
      : [{ userId: bill.creatorId, amountCents: get().getGrandTotal() }];

    for (const payer of payers) {
      payment.set(payer.userId, (payment.get(payer.userId) || 0) + payer.amountCents);
    }

    const netBalance = new Map<string, number>();
    for (const p of participants) {
      const paid = payment.get(p.id) || 0;
      const consumed = consumption.get(p.id) || 0;
      netBalance.set(p.id, paid - consumed);
    }

    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];

    for (const [id, balance] of netBalance) {
      if (balance < -1) debtors.push({ id, amount: Math.abs(balance) });
      if (balance > 1) creditors.push({ id, amount: balance });
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const entries: LedgerEntry[] = [];
    let di = 0;
    let ci = 0;

    while (di < debtors.length && ci < creditors.length) {
      const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
      if (transfer <= 0) break;

      entries.push({
        id: generateId(),
        billId: bill.id,
        entryType: "debt",
        fromUserId: debtors[di].id,
        toUserId: creditors[ci].id,
        amountCents: transfer,
        paidAmountCents: 0,
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      debtors[di].amount -= transfer;
      creditors[ci].amount -= transfer;

      if (debtors[di].amount <= 1) di++;
      if (creditors[ci].amount <= 1) ci++;
    }

    const newStatus: BillStatus = entries.length === 0 ? "settled" : "active";

    set({
      ledger: entries,
      bill: { ...bill, status: newStatus, updatedAt: new Date().toISOString() },
    });
  },

  recordPayment: (entryId, amountCents) => {
    set({
      ledger: get().ledger.map((e) => {
        if (e.id !== entryId) return e;
        const newPaid = e.paidAmountCents + amountCents;
        const remaining = e.amountCents - newPaid;
        const status: DebtStatus = remaining <= 0 ? "settled" : "partially_paid";
        return {
          ...e,
          paidAmountCents: Math.min(newPaid, e.amountCents),
          status,
          paidAt: new Date().toISOString(),
        };
      }),
    });
    checkAllSettled(get, set);
  },

  markPaid: (entryId) => {
    const entry = get().ledger.find((e) => e.id === entryId);
    if (!entry) return;
    const remaining = entry.amountCents - entry.paidAmountCents;
    get().recordPayment(entryId, remaining);
  },

  getParticipantTotal: (userId) => {
    const { bill, items, splits, billSplits, participants } = get();
    if (!bill) return 0;

    if (bill.billType === "single_amount") {
      const bs = billSplits.find((s) => s.userId === userId);
      return bs?.computedAmountCents || 0;
    }

    const itemTotal = splits
      .filter((s) => s.userId === userId)
      .reduce((sum, s) => sum + s.computedAmountCents, 0);

    const itemsGrandTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);

    let serviceFee = 0;
    if (bill.serviceFeePercent > 0 && itemsGrandTotal > 0) {
      const totalServiceFee = Math.round((itemsGrandTotal * bill.serviceFeePercent) / 100);
      const weights = participants.map((p) =>
        splits
          .filter((s) => s.userId === p.id)
          .reduce((sum, s) => sum + s.computedAmountCents, 0),
      );
      const fees = distributeProportionally(totalServiceFee, weights);
      const idx = participants.findIndex((p) => p.id === userId);
      if (idx >= 0) serviceFee = fees[idx];
    }

    let fixedFeeShare = 0;
    if (bill.fixedFees > 0 && participants.length > 0) {
      const fees = distributeEvenly(bill.fixedFees, participants.length);
      const idx = participants.findIndex((p) => p.id === userId);
      if (idx >= 0) fixedFeeShare = fees[idx];
    }

    return itemTotal + serviceFee + fixedFeeShare;
  },

  reset: () =>
    set({
      bill: null,
      participants: [],
      items: [],
      splits: [],
      billSplits: [],
      ledger: [],
    }),
}));

function recalcTotal(
  get: () => BillState,
  set: (state: Partial<BillState>) => void,
) {
  const { bill, items } = get();
  if (!bill || bill.billType === "single_amount") return;
  const totalAmount = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
  set({ bill: { ...bill, totalAmount, updatedAt: new Date().toISOString() } });
}

function checkAllSettled(
  get: () => BillState,
  set: (state: Partial<BillState>) => void,
) {
  const { bill, ledger } = get();
  if (!bill) return;
  const allSettled = ledger.every((e) => e.status === "settled");
  if (allSettled) {
    set({ bill: { ...bill, status: "settled", updatedAt: new Date().toISOString() } });
  } else {
    const anySettled = ledger.some((e) => e.status === "settled");
    if (anySettled) {
      set({
        bill: {
          ...bill,
          status: "partially_settled",
          updatedAt: new Date().toISOString(),
        },
      });
    }
  }
}
