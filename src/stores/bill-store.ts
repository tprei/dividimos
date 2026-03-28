"use client";

import { create } from "zustand";
import { distributeProportionally, distributeEvenly } from "@/lib/currency";
import type {
  DebtEdge,
  Expense,
  ExpenseItem,
  ExpensePayer,
  ExpenseShare,
  ExpenseStatus,
  ExpenseType,
  ItemSplit,
  BillSplit,
  SplitType,
  User,
} from "@/types";

interface ExpenseState {
  currentUser: User | null;
  expense: Expense | null;
  /** User-entered total for single_amount expenses (before computing shares). */
  totalAmountInput: number;
  participants: User[];
  items: ExpenseItem[];
  payers: ExpensePayer[];
  /** Per-item split assignments (itemized wizard). */
  splits: ItemSplit[];
  /** Whole-expense split assignments (single_amount wizard). */
  billSplits: BillSplit[];
  /** Client-side preview of debts (computed by computeLedger). */
  previewDebts: DebtEdge[];

  setCurrentUser: (user: User) => void;

  createExpense: (title: string, expenseType: ExpenseType, merchantName?: string, groupId?: string) => void;
  updateExpense: (updates: Partial<Expense> & { totalAmountInput?: number }) => void;
  setExpenseType: (expenseType: ExpenseType) => void;

  addParticipant: (user: User) => void;
  removeParticipant: (userId: string) => void;

  addItem: (item: Omit<ExpenseItem, "id" | "expenseId" | "createdAt">) => void;
  updateItem: (itemId: string, updates: Partial<ExpenseItem>) => void;
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
  /**
   * Computes client-side preview debts from current splits and payers.
   * Stores result in `previewDebts` as DebtEdge[].
   * Updates expense status to "active" if debts exist, "settled" if none.
   */
  computeLedger: () => void;
  /**
   * Computes final ExpenseShare[] from current splits/billSplits.
   * Used when activating an expense to send to the server.
   */
  getExpenseShares: () => ExpenseShare[];
  getParticipantTotal: (userId: string) => number;
  reset: () => void;
}

let nextId = 1;
function generateId(): string {
  return `local_${Date.now()}_${nextId++}`;
}

export const useBillStore = create<ExpenseState>((set, get) => ({
  currentUser: null,
  expense: null,
  totalAmountInput: 0,
  participants: [],
  items: [],
  payers: [],
  splits: [],
  billSplits: [],
  previewDebts: [],

  setCurrentUser: (user) => set({ currentUser: user }),

  createExpense: (title, expenseType, merchantName, groupId) => {
    const now = new Date().toISOString();
    const expense: Expense = {
      id: generateId(),
      groupId: groupId || "",
      creatorId: get().currentUser?.id || "",
      expenseType,
      title,
      merchantName,
      totalAmount: 0,
      serviceFeePercent: expenseType === "itemized" ? 10 : 0,
      fixedFees: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    const currentUser = get().currentUser;
    set({
      expense,
      totalAmountInput: 0,
      participants: currentUser ? [currentUser] : [],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      previewDebts: [],
    });
  },

  updateExpense: (updates) => {
    const expense = get().expense;
    if (!expense) return;
    const { totalAmountInput, ...expenseUpdates } = updates;
    const newState: Partial<ExpenseState> = {
      expense: { ...expense, ...expenseUpdates, updatedAt: new Date().toISOString() },
    };
    if (totalAmountInput !== undefined) {
      newState.totalAmountInput = totalAmountInput;
    }
    set(newState);
  },

  setExpenseType: (expenseType) => {
    const expense = get().expense;
    if (!expense) return;
    if (expenseType === "single_amount") {
      set({
        expense: { ...expense, expenseType, serviceFeePercent: 0, fixedFees: 0, updatedAt: new Date().toISOString() },
        items: [],
        splits: [],
      });
    } else {
      set({
        expense: { ...expense, expenseType, serviceFeePercent: 10, updatedAt: new Date().toISOString() },
        totalAmountInput: 0,
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
    const expenseItem: ExpenseItem = {
      ...item,
      id: generateId(),
      expenseId: get().expense?.id || "",
      createdAt: new Date().toISOString(),
    };
    set({ items: [...get().items, expenseItem] });
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
    const expense = get().expense;
    if (!expense) return;
    set({
      payers: [{ expenseId: expense.id, userId, amountCents: grandTotal }],
    });
  },

  splitPaymentEqually: (userIds) => {
    const grandTotal = get().getGrandTotal();
    const expense = get().expense;
    if (!expense || userIds.length === 0) return;
    const perPerson = Math.floor(grandTotal / userIds.length);
    const remainder = grandTotal - perPerson * userIds.length;
    const newPayers: ExpensePayer[] = userIds.map((userId, idx) => ({
      expenseId: expense.id,
      userId,
      amountCents: perPerson + (idx < remainder ? 1 : 0),
    }));
    set({ payers: newPayers });
  },

  setPayerAmount: (userId, amountCents) => {
    const expense = get().expense;
    if (!expense) return;
    const existing = get().payers.find((p) => p.userId === userId);
    if (existing) {
      set({
        payers: get().payers.map((p) =>
          p.userId === userId ? { ...p, amountCents } : p,
        ),
      });
    } else {
      set({
        payers: [...get().payers, { expenseId: expense.id, userId, amountCents }],
      });
    }
  },

  removePayerEntry: (userId) => {
    set({
      payers: get().payers.filter((p) => p.userId !== userId),
    });
  },

  splitBillEqually: (userIds) => {
    const expense = get().expense;
    if (!expense || userIds.length === 0) return;
    const total = get().totalAmountInput;
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
    if (!get().expense) return;
    const sum = assignments.reduce((s, a) => s + a.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) return;
    const total = get().totalAmountInput;
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
    const { expense, items, totalAmountInput } = get();
    if (!expense) return 0;
    if (expense.expenseType === "single_amount") {
      return totalAmountInput;
    }
    const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    return (
      itemsTotal +
      Math.round((itemsTotal * expense.serviceFeePercent) / 100) +
      expense.fixedFees
    );
  },

  computeLedger: () => {
    const { expense, participants, items, splits, billSplits, totalAmountInput, payers } = get();
    if (!expense || participants.length === 0) return;

    const consumption = new Map<string, number>();
    const payment = new Map<string, number>();

    for (const p of participants) {
      consumption.set(p.id, 0);
      payment.set(p.id, 0);
    }

    if (expense.expenseType === "single_amount") {
      for (const bs of billSplits) {
        consumption.set(bs.userId, (consumption.get(bs.userId) || 0) + bs.computedAmountCents);
      }
    } else {
      const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
      for (const split of splits) {
        consumption.set(split.userId, (consumption.get(split.userId) || 0) + split.computedAmountCents);
      }
      if (expense.serviceFeePercent > 0 && itemsTotal > 0) {
        const totalServiceFee = Math.round((itemsTotal * expense.serviceFeePercent) / 100);
        const weights = participants.map((p) => consumption.get(p.id) || 0);
        const fees = distributeProportionally(totalServiceFee, weights);
        participants.forEach((p, i) => {
          consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
        });
      }
      if (expense.fixedFees > 0) {
        const fees = distributeEvenly(expense.fixedFees, participants.length);
        participants.forEach((p, i) => {
          consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
        });
      }
    }

    const effectivePayers = payers.length > 0
      ? payers
      : [{ expenseId: expense.id, userId: expense.creatorId, amountCents: get().getGrandTotal() }];

    for (const payer of effectivePayers) {
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

    const debts: DebtEdge[] = [];
    let di = 0;
    let ci = 0;

    while (di < debtors.length && ci < creditors.length) {
      const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
      if (transfer <= 0) break;

      debts.push({
        fromUserId: debtors[di].id,
        toUserId: creditors[ci].id,
        amountCents: transfer,
      });

      debtors[di].amount -= transfer;
      creditors[ci].amount -= transfer;

      if (debtors[di].amount <= 1) di++;
      if (creditors[ci].amount <= 1) ci++;
    }

    const newStatus: ExpenseStatus = debts.length === 0 ? "settled" : "active";

    set({
      previewDebts: debts,
      expense: { ...expense, status: newStatus, updatedAt: new Date().toISOString() },
    });
  },

  getExpenseShares: () => {
    const { expense, participants, items, splits, billSplits, totalAmountInput } = get();
    if (!expense) return [];

    if (expense.expenseType === "single_amount") {
      return billSplits.map((bs) => ({
        id: generateId(),
        expenseId: expense.id,
        userId: bs.userId,
        shareAmountCents: bs.computedAmountCents,
      }));
    }

    // Itemized: compute each participant's total share including fees
    const itemsTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    const consumption = new Map<string, number>();

    for (const p of participants) {
      consumption.set(p.id, 0);
    }

    for (const split of splits) {
      consumption.set(split.userId, (consumption.get(split.userId) || 0) + split.computedAmountCents);
    }

    if (expense.serviceFeePercent > 0 && itemsTotal > 0) {
      const totalServiceFee = Math.round((itemsTotal * expense.serviceFeePercent) / 100);
      const weights = participants.map((p) => consumption.get(p.id) || 0);
      const fees = distributeProportionally(totalServiceFee, weights);
      participants.forEach((p, i) => {
        consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
      });
    }

    if (expense.fixedFees > 0) {
      const fees = distributeEvenly(expense.fixedFees, participants.length);
      participants.forEach((p, i) => {
        consumption.set(p.id, (consumption.get(p.id) || 0) + fees[i]);
      });
    }

    return participants
      .filter((p) => (consumption.get(p.id) || 0) > 0)
      .map((p) => ({
        id: generateId(),
        expenseId: expense.id,
        userId: p.id,
        shareAmountCents: consumption.get(p.id) || 0,
      }));
  },

  getParticipantTotal: (userId) => {
    const { expense, items, splits, billSplits, participants } = get();
    if (!expense) return 0;

    if (expense.expenseType === "single_amount") {
      const bs = billSplits.find((s) => s.userId === userId);
      return bs?.computedAmountCents || 0;
    }

    const itemsGrandTotal = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
    const userIndex = participants.findIndex((p) => p.id === userId);
    if (userIndex === -1) return 0;

    const participantItemTotals = participants.map((p) =>
      splits.filter((s) => s.userId === p.id).reduce((sum, s) => sum + s.computedAmountCents, 0),
    );

    const itemTotal = participantItemTotals[userIndex];

    let serviceFee = 0;
    if (expense.serviceFeePercent > 0 && itemsGrandTotal > 0) {
      const totalServiceFee = Math.round((itemsGrandTotal * expense.serviceFeePercent) / 100);
      serviceFee = distributeProportionally(totalServiceFee, participantItemTotals)[userIndex];
    }

    const fixedFeeShare =
      participants.length > 0
        ? distributeEvenly(expense.fixedFees, participants.length)[userIndex]
        : 0;

    return itemTotal + serviceFee + fixedFeeShare;
  },

  reset: () =>
    set({
      expense: null,
      totalAmountInput: 0,
      participants: [],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      previewDebts: [],
    }),
}));

function recalcTotal(
  get: () => ExpenseState,
  set: (state: Partial<ExpenseState>) => void,
) {
  const { expense, items } = get();
  if (!expense || expense.expenseType === "single_amount") return;
  const totalAmount = items.reduce((sum, i) => sum + i.totalPriceCents, 0);
  set({ expense: { ...expense, totalAmount, updatedAt: new Date().toISOString() } });
}
