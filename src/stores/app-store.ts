"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createIdbStorage } from "@/lib/idb-storage";
import type {
  Bootstrap,
  ChatMessage,
  ExpenseDetail,
  ExpenseSummary,
  GroupEvent,
  GroupSnapshot,
  Me,
  Transfer,
  VendorCharge,
} from "@/types/ledger";
import {
  appendPage,
  computeGroupOrder,
  listFromSeed,
  mergeActivity,
  mergeConversation,
  renameDetail,
  renameInLists,
  summaryFromDetail,
  upsertSummaries,
} from "./app-store-merge";

export interface ExpenseListState {
  ids: string[];
  oldestCursor: string | null;
  complete: boolean;
}

export interface ConversationState {
  messages: ChatMessage[];
  events: GroupEvent[];
  oldestCursor: string | null;
}

export interface MyDebts {
  groupId: string;
  owes: Transfer[];
  owed: Transfer[];
}

interface AppStateData {
  hydrated: boolean;
  me: Me | null;
  groups: Record<string, GroupSnapshot>;
  groupOrder: string[];
  expenseLists: Record<string, ExpenseListState>;
  expenses: Record<string, ExpenseSummary>;
  expenseDetails: Record<string, ExpenseDetail>;
  activity: { items: GroupEvent[]; oldestId: number | null };
  conversations: Record<string, ConversationState>;
  vendorCharges: VendorCharge[];
  lastBootstrapAt: string | null;
}

export interface AppState extends AppStateData {
  setHydrated(): void;
  applyBootstrap(b: Bootstrap): void;
  applyGroup(s: GroupSnapshot): void;
  removeGroup(groupId: string): void;
  applyExpenseDetail(d: ExpenseDetail): void;
  applyExpensePage(groupId: string, page: ExpenseSummary[], complete: boolean): void;
  applyActivity(items: GroupEvent[]): void;
  applyConversation(
    groupId: string,
    c: { messages: ChatMessage[]; events: GroupEvent[] },
    prepend: boolean,
  ): void;
  upsertExpense(summary: ExpenseSummary): void;
  replaceExpenseId(oldId: string, newId: string): void;
  patch(fn: (state: AppState) => Partial<AppState>): void;
  applyVendorCharges(list: VendorCharge[]): void;
  upsertVendorCharge(c: VendorCharge): void;
  reset(): void;
}

const initialData: AppStateData = {
  hydrated: false,
  me: null,
  groups: {},
  groupOrder: [],
  expenseLists: {},
  expenses: {},
  expenseDetails: {},
  activity: { items: [], oldestId: null },
  conversations: {},
  vendorCharges: [],
  lastBootstrapAt: null,
};

export function migrateAppState(persisted: unknown): AppStateData {
  const legacy = (persisted ?? {}) as Partial<AppStateData>;
  const groups: Record<string, GroupSnapshot> = {};
  for (const [id, snapshot] of Object.entries(legacy.groups ?? {})) {
    groups[id] =
      snapshot.expenseCount === undefined
        ? { ...snapshot, expenseCount: 0 }
        : snapshot;
  }
  return { ...initialData, ...legacy, groups };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialData,
      setHydrated: () => set({ hydrated: true }),

      applyBootstrap: (b) =>
        set((state) => {
          const groups: Record<string, GroupSnapshot> = {};
          const expenseLists: Record<string, ExpenseListState> = {};
          const conversations: Record<string, ConversationState> = {};
          const expenses = upsertSummaries(
            state.expenses,
            b.groups.flatMap((snapshot) => snapshot.recentExpenses),
          );
          for (const snapshot of b.groups) {
            const id = snapshot.group.id;
            groups[id] = snapshot;
            expenseLists[id] = listFromSeed(state.expenseLists[id], snapshot.recentExpenses, expenses);
            conversations[id] = state.conversations[id] ?? { messages: [], events: [], oldestCursor: null };
          }
          return {
            me: b.me,
            groups,
            groupOrder: computeGroupOrder(groups),
            expenseLists,
            conversations,
            expenses,
            lastBootstrapAt: new Date().toISOString(),
          };
        }),

      applyGroup: (s) =>
        set((state) => {
          const id = s.group.id;
          const current = state.groups[id];
          if (current && s.group.ledgerVersion < current.group.ledgerVersion) return {};
          const groups = { ...state.groups, [id]: s };
          const expenses = upsertSummaries(state.expenses, s.recentExpenses);
          return {
            groups,
            groupOrder: computeGroupOrder(groups),
            expenses,
            expenseLists: {
              ...state.expenseLists,
              [id]: listFromSeed(state.expenseLists[id], s.recentExpenses, expenses),
            },
          };
        }),

      removeGroup: (groupId) =>
        set((state) => {
          if (!(groupId in state.groups)) return {};
          const groups = { ...state.groups };
          delete groups[groupId];
          const expenseLists = { ...state.expenseLists };
          delete expenseLists[groupId];
          const conversations = { ...state.conversations };
          delete conversations[groupId];
          const expenses: Record<string, ExpenseSummary> = {};
          for (const [id, summary] of Object.entries(state.expenses)) {
            if (summary.groupId !== groupId) expenses[id] = summary;
          }
          const expenseDetails: Record<string, ExpenseDetail> = {};
          for (const [id, detail] of Object.entries(state.expenseDetails)) {
            if (detail.expense.groupId !== groupId) expenseDetails[id] = detail;
          }
          return {
            groups,
            groupOrder: computeGroupOrder(groups),
            expenseLists,
            conversations,
            expenses,
            expenseDetails,
          };
        }),

      applyExpenseDetail: (d) =>
        set((state) => ({
          expenseDetails: { ...state.expenseDetails, [d.expense.id]: d },
          expenses: upsertSummaries(state.expenses, [summaryFromDetail(d, state.me?.id ?? null)]),
        })),

      applyExpensePage: (groupId, page, complete) =>
        set((state) => ({
          expenses: upsertSummaries(state.expenses, page),
          expenseLists: {
            ...state.expenseLists,
            [groupId]: appendPage(state.expenseLists[groupId], page, complete),
          },
        })),

      applyActivity: (items) =>
        set((state) => ({ activity: mergeActivity(state.activity.items, items) })),

      applyConversation: (groupId, c, prepend) =>
        set((state) => ({
          conversations: {
            ...state.conversations,
            [groupId]: mergeConversation(state.conversations[groupId], c, prepend),
          },
        })),

      upsertExpense: (summary) =>
        set((state) => {
          const list = state.expenseLists[summary.groupId] ?? {
            ids: [],
            oldestCursor: null,
            complete: false,
          };
          return {
            expenses: upsertSummaries(state.expenses, [summary]),
            expenseLists: {
              ...state.expenseLists,
              [summary.groupId]: {
                ...list,
                ids: [summary.id, ...list.ids.filter((id) => id !== summary.id)],
              },
            },
          };
        }),

      replaceExpenseId: (oldId, newId) =>
        set((state) => {
          const summary = state.expenses[oldId];
          if (!summary) return {};
          const expenses = { ...state.expenses };
          delete expenses[oldId];
          expenses[newId] = { ...summary, id: newId };
          const detail = state.expenseDetails[oldId];
          if (!detail) return { expenses, expenseLists: renameInLists(state.expenseLists, oldId, newId) };
          const expenseDetails = { ...state.expenseDetails };
          delete expenseDetails[oldId];
          expenseDetails[newId] = renameDetail(detail, newId);
          return {
            expenses,
            expenseLists: renameInLists(state.expenseLists, oldId, newId),
            expenseDetails,
          };
        }),
      applyVendorCharges: (list) => set({ vendorCharges: list }),

      upsertVendorCharge: (c) =>
        set((state) => {
          const idx = state.vendorCharges.findIndex((x) => x.id === c.id);
          if (idx === -1) {
            return { vendorCharges: [c, ...state.vendorCharges] };
          }
          const next = [...state.vendorCharges];
          next[idx] = c;
          return { vendorCharges: next };
        }),


      patch: (fn) => set((state) => fn(state)),

      reset: () => {
        set({ ...initialData, hydrated: true });
        useAppStore.persist.clearStorage();
      },
    }),
    {
      name: "dividimos-app",
      storage: createJSONStorage(() => createIdbStorage("dividimos", "app")),
      partialize: (state) => ({
        me: state.me,
        groups: state.groups,
        groupOrder: state.groupOrder,
        expenseLists: state.expenseLists,
        expenses: state.expenses,
        expenseDetails: state.expenseDetails,
        activity: state.activity,
        conversations: state.conversations,
        vendorCharges: state.vendorCharges,
        lastBootstrapAt: state.lastBootstrapAt,
      }),
      onRehydrateStorage: () => () => {
        useAppStore.setState({ hydrated: true });
      },
      skipHydration: true,
      migrate: migrateAppState,
      version: 2,
    },
  ),
);

