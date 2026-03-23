"use client";

import { create } from "zustand";
import type {
  Bill,
  BillItem,
  BillStatus,
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
  ledger: LedgerEntry[];

  setCurrentUser: (user: User) => void;

  createBill: (title: string, merchantName?: string) => void;
  updateBill: (updates: Partial<Bill>) => void;

  addParticipant: (user: User) => void;
  removeParticipant: (userId: string) => void;

  addItem: (item: Omit<BillItem, "id" | "billId" | "createdAt">) => void;
  updateItem: (itemId: string, updates: Partial<BillItem>) => void;
  removeItem: (itemId: string) => void;

  assignItem: (
    itemId: string,
    userId: string,
    splitType: SplitType,
    value: number,
  ) => void;
  unassignItem: (itemId: string, userId: string) => void;
  splitItemEqually: (itemId: string, userIds: string[]) => void;

  computeLedger: () => void;
  markPaid: (entryId: string) => void;
  confirmPayment: (entryId: string) => void;

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
  ledger: [],

  setCurrentUser: (user) => set({ currentUser: user }),

  createBill: (title, merchantName) => {
    const bill: Bill = {
      id: generateId(),
      creatorId: get().currentUser?.id || "",
      title,
      merchantName,
      status: "draft",
      serviceFeePercent: 10,
      fixedFees: 0,
      totalAmount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const currentUser = get().currentUser;
    set({
      bill,
      participants: currentUser ? [currentUser] : [],
      items: [],
      splits: [],
      ledger: [],
    });
  },

  updateBill: (updates) => {
    const bill = get().bill;
    if (!bill) return;
    set({ bill: { ...bill, ...updates, updatedAt: new Date().toISOString() } });
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

  computeLedger: () => {
    const { bill, participants, items, splits } = get();
    if (!bill || participants.length === 0) return;

    const creatorId = bill.creatorId;
    const participantTotals = new Map<string, number>();

    for (const p of participants) {
      participantTotals.set(p.id, 0);
    }

    for (const split of splits) {
      const current = participantTotals.get(split.userId) || 0;
      participantTotals.set(split.userId, current + split.computedAmountCents);
    }

    const itemsGrandTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);

    const entries: LedgerEntry[] = [];
    for (const [userId, itemTotal] of participantTotals) {
      if (userId === creatorId) continue;

      let serviceFee = 0;
      if (bill.serviceFeePercent > 0 && itemsGrandTotal > 0) {
        serviceFee = Math.round(
          (itemTotal / itemsGrandTotal) * (itemsGrandTotal * bill.serviceFeePercent) / 100,
        );
      }

      const fixedFeeShare = Math.round(
        bill.fixedFees / participants.length,
      );

      const totalOwed = itemTotal + serviceFee + fixedFeeShare;
      if (totalOwed <= 0) continue;

      entries.push({
        id: generateId(),
        billId: bill.id,
        fromUserId: userId,
        toUserId: creatorId,
        amountCents: totalOwed,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    const newStatus: BillStatus =
      entries.length === 0 ? "settled" : "active";

    set({
      ledger: entries,
      bill: { ...bill, status: newStatus, updatedAt: new Date().toISOString() },
    });
  },

  markPaid: (entryId) => {
    set({
      ledger: get().ledger.map((e) =>
        e.id === entryId
          ? { ...e, status: "paid_unconfirmed" as DebtStatus, paidAt: new Date().toISOString() }
          : e,
      ),
    });
  },

  confirmPayment: (entryId) => {
    set({
      ledger: get().ledger.map((e) =>
        e.id === entryId
          ? { ...e, status: "settled" as DebtStatus, confirmedAt: new Date().toISOString() }
          : e,
      ),
    });
    checkAllSettled(get, set);
  },

  getParticipantTotal: (userId) => {
    const { bill, items, splits, participants } = get();
    if (!bill) return 0;

    const itemTotal = splits
      .filter((s) => s.userId === userId)
      .reduce((sum, s) => sum + s.computedAmountCents, 0);

    const itemsGrandTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);

    let serviceFee = 0;
    if (bill.serviceFeePercent > 0 && itemsGrandTotal > 0) {
      serviceFee = Math.round(
        (itemTotal / itemsGrandTotal) * (itemsGrandTotal * bill.serviceFeePercent) / 100,
      );
    }

    const fixedFeeShare =
      participants.length > 0
        ? Math.round(bill.fixedFees / participants.length)
        : 0;

    return itemTotal + serviceFee + fixedFeeShare;
  },

  reset: () =>
    set({
      bill: null,
      participants: [],
      items: [],
      splits: [],
      ledger: [],
    }),
}));

function recalcTotal(
  get: () => BillState,
  set: (state: Partial<BillState>) => void,
) {
  const { bill, items } = get();
  if (!bill) return;
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
