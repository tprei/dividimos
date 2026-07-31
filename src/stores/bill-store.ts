"use client";

import { create } from "zustand";
import { allocateByWeights, allocateEvenly, computeServiceFeeCents } from "@/lib/expense-money";
import type { ExpenseAllocationIssue } from "@/lib/expense-money";
import type {
  DebtEdge,
  Expense,
  ExpenseItem,
  ExpensePayer,
  ExpenseShare,
  ExpenseStatus,
  ExpenseType,
  SplitType,
  User,
} from "@/types";

export interface ExpenseSplit {
  id: string;
  itemId: string;
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

export interface AmountSplit {
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

/** A guest participant who doesn't have a Dividimos account yet. */
export interface Guest {
  /** Local ID with "guest_" prefix to distinguish from user IDs. */
  id: string;
  /** Display name entered by the expense creator. */
  name: string;
  /** Phone number from contact picker, used for WhatsApp claim link delivery. */
  phone?: string;
}

interface ExpenseState {
  currentUser: User | null;
  expense: Expense | null;
  /** User-entered total for single_amount expenses (before computing shares). */
  totalAmountInput: number;
  participants: User[];
  /** Guest participants who don't have Dividimos accounts yet. */
  guests: Guest[];
  items: ExpenseItem[];
  payers: ExpensePayer[];
  /** Per-item split assignments (itemized wizard). */
  splits: ExpenseSplit[];
  /** Whole-expense split assignments (single_amount wizard). */
  billSplits: AmountSplit[];
  /** Users protected from removal because their share came from a claimed
   *  guest (#495). Populated only when editing an existing draft that has
   *  one; empty for new/active/settled expenses. */
  draftClaimProtectedUserIds: string[];
  /**
   * Monotonically increasing counter bumped exactly once on every
   * hydration/source/type reset transition (issue #477's
   * `DraftSessionState.inputResetRevision`): `createExpense`,
   * `createExpenseFromDm`, `hydrateFromChatDraft`, `hydrateFromServer`,
   * `setExpenseType` (real type switch only), and `reset`. Money-entry
   * components pass it through as `CurrencyInput`/`AmountQuickAdd`'s
   * `resetRevision` prop so a stale invalid override or undo entry from a
   * prior draft/type can never survive a reset transition, even when the
   * numeric cents value happens to be unchanged.
   */
  inputResetRevision: number;

  setCurrentUser: (user: User) => void;

  createExpense: (title: string, expenseType: ExpenseType, merchantName?: string, groupId?: string) => void;
  updateExpense: (updates: Partial<Expense> & { totalAmountInput?: number }) => void;
  setExpenseType: (expenseType: ExpenseType) => void;

  addParticipant: (user: User) => void;
  removeParticipant: (userId: string) => void;

  /** Adds a guest by name. Returns the generated guest ID. */
  addGuest: (name: string, phone?: string) => string;
  /** Removes a guest and cascades removal to splits and billSplits. */
  removeGuest: (guestId: string) => void;
  /** Updates a guest's display name. */
  updateGuest: (guestId: string, name: string) => void;

  addItem: (item: Omit<ExpenseItem, "id" | "expenseId" | "createdAt">) => void;
  updateItem: (itemId: string, updates: Partial<ExpenseItem>) => void;
  removeItem: (itemId: string) => void;

  assignItem: (itemId: string, userId: string, splitType: SplitType, value: number) => void;
  unassignItem: (itemId: string, userId: string) => void;
  splitItemEqually: (itemId: string, userIds: string[]) => void;

  setPayerFull: (userId: string) => PayerMutationResult;
  splitPaymentEqually: (userIds: string[]) => PayerMutationResult;
  setPayerAmount: (userId: string, amountCents: number) => PayerMutationResult;
  removePayerEntry: (userId: string) => void;

  splitBillEqually: (userIds: string[]) => void;
  splitBillByPercentage: (assignments: { userId: string; percentage: number }[]) => void;
  splitBillByFixed: (assignments: { userId: string; amountCents: number }[]) => void;

  getGrandTotal: () => number;
  /**
   * Computes final ExpenseShare[] from current splits/billSplits.
   * Used when activating an expense to send to the server.
   */
  getExpenseShares: () => ExpenseShare[];
  /**
   * Returns true when the current splits and payers would produce zero debt
   * edges — i.e. everyone already owes nothing because each person paid
   * exactly what they consumed.
   */
  wouldProduceNoEdges: () => boolean;
  getParticipantTotal: (userId: string) => number;
  hydrateFromVoice: (result: VoiceExpenseResult, groupId?: string) => void;
  /**
   * Initializes a single_amount expense for a DM conversation.
   * Sets the groupId and adds the counterparty as participant.
   */
  createExpenseFromDm: (groupId: string, counterparty: User) => void;
  /**
   * Hydrates the store from an AI-parsed chat expense draft.
   * Pre-fills title, amount, type, items, and participants for wizard editing.
   */
  hydrateFromChatDraft: (result: ChatExpenseResult, groupId: string, counterparty: User) => void;
  /**
   * Hydrates the store from a server-loaded expense snapshot.
   * Clears all wizard state before applying the new data to prevent zombie
   * state from a prior session.
   */
  hydrateFromServer: (input: {
    expense: Expense;
    items: ExpenseItem[];
    participants?: User[];
    guests?: Guest[];
    payers?: ExpensePayer[];
    billSplits?: AmountSplit[];
    /** Users whose share came from a claimed guest -- see #495 spec: their
     *  removal control must be hidden and their removal is a whole-state
     *  no-op (the server rejects it with `claimed_guest_not_participant`). */
    draftClaimProtectedUserIds?: string[];
  }) => void;
  /**
   * Patches only the server-derived status fields from a realtime event.
   * Does not reload — only touches status and updatedAt on the expense.
   */
  patchExpenseFromRealtime: (updated: { id: string; status: ExpenseStatus; updatedAt: string }) => void;
  reset: () => void;
}

let nextId = 1;
function generateId(): string {
  return `local_${Date.now()}_${nextId++}`;
}

type PayerMutationResult = ExpenseAllocationIssue | null;

function getGrandTotalFor(
  expense: Expense | null,
  items: readonly ExpenseItem[],
  totalAmountInput: number,
): number {
  if (!expense) return 0;
  if (expense.expenseType === "single_amount") return totalAmountInput;

  const itemsTotal = items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const feeResult = computeServiceFeeCents(itemsTotal, expense.serviceFeeBasisPoints);
  return itemsTotal + (feeResult.ok ? feeResult.value : 0) + expense.fixedFees;
}

function recalculateItemizedExpense(
  expense: Expense | null,
  items: readonly ExpenseItem[],
  updatedAt: string,
): Expense | null {
  if (!expense || expense.expenseType === "single_amount") return expense;

  return {
    ...expense,
    totalAmount: items.reduce((sum, item) => sum + item.totalPriceCents, 0),
    updatedAt,
  };
}

function validatePayerCandidates(
  state: Pick<ExpenseState, "participants">,
  userIds: readonly string[],
): PayerMutationResult {
  const eligibleUserIds = new Set(state.participants.map((participant) => participant.id));
  const seenUserIds = new Set<string>();

  for (let payerIndex = 0; payerIndex < userIds.length; payerIndex += 1) {
    const userId = userIds[payerIndex];
    if (!eligibleUserIds.has(userId)) {
      return { code: "ineligible_payer", payerIndex };
    }
    if (seenUserIds.has(userId)) {
      return { code: "duplicate_payer", payerIndex };
    }
    seenUserIds.add(userId);
  }

  return null;
}

/**
 * Pure function that computes each participant's consumption in centavos.
 * Shared by selectPreviewDebts, getExpenseShares, wouldProduceNoEdges, and getParticipantTotal.
 */
function computeConsumption(
  expense: Expense,
  allPersonIds: string[],
  items: ExpenseItem[],
  splits: ExpenseSplit[],
  billSplits: AmountSplit[],
): Map<string, number> {
  const consumption = new Map<string, number>();
  for (const id of allPersonIds) {
    consumption.set(id, 0);
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
    if (expense.serviceFeeBasisPoints > 0 && itemsTotal > 0) {
      const feeResult = computeServiceFeeCents(itemsTotal, expense.serviceFeeBasisPoints);
      const totalServiceFee = feeResult.ok ? feeResult.value : 0;
      const weights = allPersonIds.map((id) => consumption.get(id) || 0);
      const feesRes = allocateByWeights(totalServiceFee, weights);
      if (!feesRes.ok) return consumption;
      const fees = feesRes.value;
      allPersonIds.forEach((id, i) => {
        consumption.set(id, (consumption.get(id) || 0) + fees[i]);
      });
    }
    if (expense.fixedFees > 0) {
      const feesRes = allocateEvenly(expense.fixedFees, allPersonIds.length);
      if (!feesRes.ok) return consumption;
      const fees = feesRes.value;
      allPersonIds.forEach((id, i) => {
        consumption.set(id, (consumption.get(id) || 0) + fees[i]);
      });
    }
  }

  return consumption;
}

/**
 * Memoized wrapper around computeConsumption.
 *
 * Outer key: the expense object reference (WeakMap invalidates automatically
 * when expense is replaced via createExpense / hydrateFromServer / reset).
 * Inner key: reference tuple of the five mutable slices so mutations to
 * participants/guests/items/splits/billSplits also bust the cache.
 */
type InnerCacheKey = {
  participants: User[];
  guests: Guest[];
  items: ExpenseItem[];
  splits: ExpenseSplit[];
  billSplits: AmountSplit[];
};
type CacheEntry = { key: InnerCacheKey; result: Map<string, number> };
const _consumptionCache = new WeakMap<Expense, CacheEntry>();

function getCachedConsumption(state: ExpenseState): Map<string, number> | null {
  const { expense, participants, guests, items, splits, billSplits } = state;
  if (!expense) return null;

  const allPersonIds = [...participants.map((p) => p.id), ...guests.map((g) => g.id)];
  if (allPersonIds.length === 0) return null;

  const existing = _consumptionCache.get(expense);
  if (
    existing &&
    existing.key.participants === participants &&
    existing.key.guests === guests &&
    existing.key.items === items &&
    existing.key.splits === splits &&
    existing.key.billSplits === billSplits
  ) {
    return existing.result;
  }

  const result = computeConsumption(expense, allPersonIds, items, splits, billSplits);
  _consumptionCache.set(expense, { key: { participants, guests, items, splits, billSplits }, result });
  return result;
}

/** Exported for testing — returns true when cache holds a valid entry for the current expense. */
export function _testGetCacheState() {
  const expense = useBillStore.getState().expense;
  return { hasCachedResult: expense !== null && _consumptionCache.has(expense) };
}

/**
 * Pure selector: computes preview debts from store state without mutating anything.
 * Replaces the old computeLedger action.
 */
export function selectPreviewDebts(state: ExpenseState): DebtEdge[] {
  const { expense, participants, guests, payers } = state;
  const consumption = getCachedConsumption(state);
  if (!expense || !consumption) return [];

  const allPersonIds = [...participants.map((p) => p.id), ...guests.map((g) => g.id)];
  const payment = new Map<string, number>();
  for (const id of allPersonIds) {
    payment.set(id, 0);
  }

  for (const payer of payers) {
    payment.set(payer.userId, (payment.get(payer.userId) || 0) + payer.amountCents);
  }

  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  for (const id of allPersonIds) {
    const net = (payment.get(id) || 0) - (consumption.get(id) || 0);
    if (net < 0) debtors.push({ id, amount: Math.abs(net) });
    if (net > 0) creditors.push({ id, amount: net });
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

    if (debtors[di].amount <= 0) di++;
    if (creditors[ci].amount <= 0) ci++;
  }

  return debts;
}

/**
 * Pure mapper: turns a loaded expense's raw guest rows (as returned by
 * `loadExpense`) into the store-shaped `guests` list and, for
 * `single_amount` expenses, the guest portion of `billSplits`.
 *
 * Extracted from the wizard's edit-mode hydration effect so this exact
 * mapping is directly unit-testable, independent of the page component.
 * A prior version of that inline logic silently dropped every guest
 * (hardcoded `guests: []`), deleting them permanently on the next save;
 * regression coverage for that class of bug belongs here, not only in
 * `hydrateFromServer` itself, so a future revert of the wizard's call
 * site is caught even if `hydrateFromServer` keeps behaving correctly.
 *
 * Already-claimed guests are excluded: a claimed guest is no longer a
 * mutable, unclaimed placeholder and must never be resubmitted as
 * `p_guests` on the next save.
 */
export function mapLoadedGuestsForEditHydration(
  loadedGuests: readonly {
    id: string;
    displayName: string;
    claimedBy?: string;
    share?: { shareAmountCents: number };
  }[],
  expenseType: ExpenseType,
): { guests: Guest[]; guestBillSplits: AmountSplit[] } {
  const unclaimed = loadedGuests.filter((g) => !g.claimedBy);
  const guests: Guest[] = unclaimed.map((g) => ({ id: g.id, name: g.displayName }));
  const guestBillSplits: AmountSplit[] =
    expenseType === "single_amount"
      ? unclaimed.map((g) => ({
          userId: g.id,
          splitType: "fixed" as const,
          value: g.share?.shareAmountCents ?? 0,
          computedAmountCents: g.share?.shareAmountCents ?? 0,
        }))
      : [];
  return { guests, guestBillSplits };
}

export const useBillStore = create<ExpenseState>((set, get) => ({
  currentUser: null,
  expense: null,
  totalAmountInput: 0,
  participants: [],
  guests: [],
  items: [],
  payers: [],
  splits: [],
  billSplits: [],
  draftClaimProtectedUserIds: [],
  inputResetRevision: 0,

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
      serviceFeeBasisPoints: expenseType === "itemized" ? 1000 : 0,
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
      guests: [],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      draftClaimProtectedUserIds: [],
      inputResetRevision: get().inputResetRevision + 1,
    });
  },

  updateExpense: (updates) => {
    set((state) => {
      const expense = state.expense;
      if (!expense) return {};

      const { totalAmountInput, ...expenseUpdates } = updates;
      // A percent update without a paired basis-points update would leave
      // serviceFeeBasisPoints silently stale (still reflecting the old
      // rate), and every fee-amount computation reads only the basis
      // points field. Derive it here so callers can never desync the two.
      const derivedBasisPoints =
        expenseUpdates.serviceFeePercent !== undefined && expenseUpdates.serviceFeeBasisPoints === undefined
          ? { serviceFeeBasisPoints: Math.round(expenseUpdates.serviceFeePercent * 100) }
          : {};
      const nextExpense: Expense = {
        ...expense,
        ...expenseUpdates,
        ...derivedBasisPoints,
        updatedAt: new Date().toISOString(),
      };
      const nextTotalAmountInput =
        totalAmountInput === undefined ? state.totalAmountInput : totalAmountInput;
      const totalChanged =
        nextExpense.expenseType !== expense.expenseType ||
        getGrandTotalFor(expense, state.items, state.totalAmountInput) !==
          getGrandTotalFor(nextExpense, state.items, nextTotalAmountInput);

      return {
        expense: nextExpense,
        ...(totalAmountInput === undefined ? {} : { totalAmountInput }),
        ...(totalChanged ? { payers: [] } : {}),
      };
    });
  },

  setExpenseType: (expenseType) => {
    set((state) => {
      const expense = state.expense;
      if (!expense || expense.expenseType === expenseType) return {};

      const updatedAt = new Date().toISOString();
      if (expenseType === "single_amount") {
        return {
          expense: {
            ...expense,
            expenseType,
            serviceFeePercent: 0,
            serviceFeeBasisPoints: 0,
            fixedFees: 0,
            updatedAt,
          },
          items: [],
          splits: [],
          payers: [],
          inputResetRevision: state.inputResetRevision + 1,
        };
      }

      return {
        expense: {
          ...expense,
          expenseType,
          serviceFeePercent: 10,
          serviceFeeBasisPoints: 1000,
          updatedAt,
        },
        totalAmountInput: 0,
        billSplits: [],
        payers: [],
        inputResetRevision: state.inputResetRevision + 1,
      };
    });
  },

  addParticipant: (user) => {
    set((state) => {
      if (state.participants.some((participant) => participant.id === user.id)) {
        return {};
      }
      return { participants: [...state.participants, user] };
    });
  },

  removeParticipant: (userId) => {
    set((state) => {
      if (
        !state.participants.some((participant) => participant.id === userId) ||
        state.draftClaimProtectedUserIds.includes(userId)
      ) {
        return {};
      }

      return {
        participants: state.participants.filter((participant) => participant.id !== userId),
        splits: state.splits.filter((split) => split.userId !== userId),
        billSplits: state.billSplits.filter((split) => split.userId !== userId),
        payers: state.payers.filter((payer) => payer.userId !== userId),
      };
    });
  },

  addGuest: (name, phone) => {
    const id = `guest_${generateId()}`;
    const guest: Guest = { id, name, phone };
    set((state) => ({ guests: [...state.guests, guest] }));
    return id;
  },

  removeGuest: (guestId) => {
    set((state) => ({
      guests: state.guests.filter((guest) => guest.id !== guestId),
      splits: state.splits.filter((split) => split.userId !== guestId),
      billSplits: state.billSplits.filter((split) => split.userId !== guestId),
      payers: state.payers.filter((payer) => payer.userId !== guestId),
    }));
  },

  updateGuest: (guestId, name) => {
    set({
      guests: get().guests.map((g) => (g.id === guestId ? { ...g, name } : g)),
    });
  },

  addItem: (item) => {
    set((state) => {
      const now = new Date().toISOString();
      const expenseItem: ExpenseItem = {
        ...item,
        id: generateId(),
        expenseId: state.expense?.id || "",
        createdAt: now,
      };
      const items = [...state.items, expenseItem];
      const expense = recalculateItemizedExpense(state.expense, items, now);
      const totalChanged =
        getGrandTotalFor(state.expense, state.items, state.totalAmountInput) !==
        getGrandTotalFor(expense, items, state.totalAmountInput);

      return {
        items,
        expense,
        ...(totalChanged ? { payers: [] } : {}),
      };
    });
  },

  updateItem: (itemId, updates) => {
    set((state) => {
      if (!state.items.some((item) => item.id === itemId)) return {};

      const items = state.items.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item,
      );
      const expense = recalculateItemizedExpense(
        state.expense,
        items,
        new Date().toISOString(),
      );
      const totalChanged =
        getGrandTotalFor(state.expense, state.items, state.totalAmountInput) !==
        getGrandTotalFor(expense, items, state.totalAmountInput);

      return {
        items,
        expense,
        ...(totalChanged ? { payers: [] } : {}),
      };
    });
  },

  removeItem: (itemId) => {
    set((state) => {
      if (!state.items.some((item) => item.id === itemId)) return {};

      const items = state.items.filter((item) => item.id !== itemId);
      const expense = recalculateItemizedExpense(
        state.expense,
        items,
        new Date().toISOString(),
      );
      const totalChanged =
        getGrandTotalFor(state.expense, state.items, state.totalAmountInput) !==
        getGrandTotalFor(expense, items, state.totalAmountInput);

      return {
        items,
        expense,
        splits: state.splits.filter((split) => split.itemId !== itemId),
        ...(totalChanged ? { payers: [] } : {}),
      };
    });
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
      const split: ExpenseSplit = {
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
    const newSplits: ExpenseSplit[] = userIds.map((userId, idx) => ({
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
    const state = get();
    const expense = state.expense;
    if (!expense) return null;

    const issue = validatePayerCandidates(state, [userId]);
    if (issue) return issue;

    set({
      payers: [{
        expenseId: expense.id,
        userId,
        amountCents: state.getGrandTotal(),
      }],
    });
    return null;
  },

  splitPaymentEqually: (userIds) => {
    const state = get();
    const expense = state.expense;
    if (!expense || userIds.length === 0) return null;

    const issue = validatePayerCandidates(state, userIds);
    if (issue) return issue;

    const grandTotal = state.getGrandTotal();
    const perPerson = Math.floor(grandTotal / userIds.length);
    const remainder = grandTotal - perPerson * userIds.length;
    const payers: ExpensePayer[] = userIds.map((userId, index) => ({
      expenseId: expense.id,
      userId,
      amountCents: perPerson + (index < remainder ? 1 : 0),
    }));
    set({ payers });
    return null;
  },

  setPayerAmount: (userId, amountCents) => {
    const state = get();
    const expense = state.expense;
    if (!expense) return null;

    const issue = validatePayerCandidates(state, [userId]);
    if (issue) return issue;

    const existing = state.payers.find((payer) => payer.userId === userId);
    if (existing) {
      set({
        payers: state.payers.map((payer) =>
          payer.userId === userId ? { ...payer, amountCents } : payer,
        ),
      });
    } else {
      set({
        payers: [...state.payers, { expenseId: expense.id, userId, amountCents }],
      });
    }
    return null;
  },

  removePayerEntry: (userId) => {
    set((state) => ({
      payers: state.payers.filter((payer) => payer.userId !== userId),
    }));
  },

  splitBillEqually: (userIds) => {
    const expense = get().expense;
    if (!expense || userIds.length === 0) return;
    const total = get().totalAmountInput;
    const perPerson = Math.floor(total / userIds.length);
    const remainder = total - perPerson * userIds.length;
    const billSplits: AmountSplit[] = userIds.map((userId, idx) => ({
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
    const billSplits: AmountSplit[] = assignments.map((a) => ({
      userId: a.userId,
      splitType: "percentage" as SplitType,
      value: a.percentage,
      computedAmountCents: Math.round((total * a.percentage) / 100),
    }));
    set({ billSplits });
  },

  splitBillByFixed: (assignments) => {
    const billSplits: AmountSplit[] = assignments.map((a) => ({
      userId: a.userId,
      splitType: "fixed" as SplitType,
      value: a.amountCents,
      computedAmountCents: a.amountCents,
    }));
    set({ billSplits });
  },

  getGrandTotal: () => {
    const { expense, items, totalAmountInput } = get();
    return getGrandTotalFor(expense, items, totalAmountInput);
  },

  wouldProduceNoEdges: () => {
    const state = get();
    const { expense, participants, guests, payers } = state;
    const consumption = getCachedConsumption(state);
    if (!expense || !consumption) return true;

    const allPersonIds = [...participants.map((p) => p.id), ...guests.map((g) => g.id)];
    const payment = new Map<string, number>();
    for (const id of allPersonIds) {
      payment.set(id, 0);
    }

    for (const payer of payers) {
      payment.set(payer.userId, (payment.get(payer.userId) || 0) + payer.amountCents);
    }

    for (const id of allPersonIds) {
      const net = (payment.get(id) || 0) - (consumption.get(id) || 0);
      if (net !== 0) return false;
    }
    return true;
  },

  getExpenseShares: () => {
    const state = get();
    const { expense, participants, guests } = state;
    if (!expense) return [];

    const consumption = getCachedConsumption(state);
    if (!consumption) return [];
    const allPersonIds = [
      ...participants.map((participant) => participant.id),
      ...guests.map((guest) => guest.id),
    ];

    return allPersonIds.map((id) => ({
      id: generateId(),
      expenseId: expense.id,
      userId: id,
      shareAmountCents: consumption.get(id) || 0,
    }));
  },

  getParticipantTotal: (userId) => {
    const state = get();
    const consumption = getCachedConsumption(state);
    if (!consumption) return 0;
    return consumption.get(userId) || 0;
  },

  hydrateFromVoice: (result, groupId) => {
    get().reset();
    const currentUser = get().currentUser;
    if (!currentUser) return;

    const now = new Date().toISOString();
    const expense: Expense = {
      id: generateId(),
      groupId: groupId || "",
      creatorId: currentUser.id,
      expenseType: result.expenseType,
      title: result.title || "Despesa por voz",
      merchantName: result.merchantName ?? undefined,
      totalAmount: result.amountCents,
      // #477: voice/chat provider results carry no fee data (the source
      // schema has no fee field) - defaulting to 10% here would silently
      // persist an unconfirmed fee the user never saw or set. The manual
      // 10% default belongs only to the visibly-configured itemized form
      // (createExpense/setExpenseType), never to source hydration.
      serviceFeePercent: 0,
      serviceFeeBasisPoints: 0,
      fixedFees: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const items: ExpenseItem[] = result.items.map((item) => ({
      id: generateId(),
      expenseId: expense.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
      createdAt: now,
    }));

    set({
      expense,
      totalAmountInput: result.expenseType === "single_amount" ? result.amountCents : 0,
      participants: [currentUser],
      guests: [],
      items,
      payers: [],
      splits: [],
      billSplits: [],
    });
  },

  createExpenseFromDm: (groupId, counterparty) => {
    const currentUser = get().currentUser;
    if (!currentUser) return;

    const now = new Date().toISOString();
    const expense: Expense = {
      id: generateId(),
      groupId,
      creatorId: currentUser.id,
      expenseType: "single_amount",
      title: "",
      totalAmount: 0,
      serviceFeePercent: 0,
      serviceFeeBasisPoints: 0,
      fixedFees: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    set({
      expense,
      totalAmountInput: 0,
      participants: [currentUser, counterparty],
      guests: [],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      draftClaimProtectedUserIds: [],
      inputResetRevision: get().inputResetRevision + 1,
    });
  },

  hydrateFromChatDraft: (result, groupId, counterparty) => {
    const currentUser = get().currentUser;
    if (!currentUser) return;

    const now = new Date().toISOString();
    const expense: Expense = {
      id: generateId(),
      groupId,
      creatorId: currentUser.id,
      expenseType: result.expenseType,
      title: result.title || "",
      merchantName: result.merchantName ?? undefined,
      totalAmount: result.amountCents,
      // #477: same rule as hydrateFromVoice - chat provider results carry
      // no fee data, so hydration must never silently apply one.
      serviceFeePercent: 0,
      serviceFeeBasisPoints: 0,
      fixedFees: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const items: ExpenseItem[] = result.items.map((item) => ({
      id: generateId(),
      expenseId: expense.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
      createdAt: now,
    }));

    const payers: ExpensePayer[] = [];
    if (result.payerHandle) {
      const payerId =
        result.payerHandle === "SELF"
          ? currentUser.id
          : counterparty.handle === result.payerHandle
            ? counterparty.id
            : null;
      if (payerId) {
        payers.push({
          expenseId: expense.id,
          userId: payerId,
          amountCents: result.amountCents,
        });
      }
    }

    set({
      expense,
      totalAmountInput: result.expenseType === "single_amount" ? result.amountCents : 0,
      participants: [currentUser, counterparty],
      guests: [],
      items,
      payers,
      splits: [],
      billSplits: [],
      draftClaimProtectedUserIds: [],
      inputResetRevision: get().inputResetRevision + 1,
    });
  },

  hydrateFromServer: ({
    expense,
    items,
    participants,
    guests,
    payers,
    billSplits,
    draftClaimProtectedUserIds,
  }) => {
    set({
      expense,
      items,
      totalAmountInput: expense.expenseType === "single_amount" ? expense.totalAmount : 0,
      participants: participants ?? [],
      guests: guests ?? [],
      payers: payers ?? [],
      splits: [],
      billSplits: billSplits ?? [],
      draftClaimProtectedUserIds: draftClaimProtectedUserIds ?? [],
      inputResetRevision: get().inputResetRevision + 1,
    });
  },

  patchExpenseFromRealtime: (updated) => {
    set((state) => ({
      expense: state.expense
        ? { ...state.expense, status: updated.status, updatedAt: updated.updatedAt }
        : null,
    }));
  },

  reset: () => {
    set({
      expense: null,
      totalAmountInput: 0,
      participants: [],
      guests: [],
      items: [],
      payers: [],
      splits: [],
      billSplits: [],
      draftClaimProtectedUserIds: [],
      inputResetRevision: get().inputResetRevision + 1,
    });
  },
}));
