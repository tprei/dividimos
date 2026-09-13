"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createIdbStorage } from "@/lib/idb-storage";
import { type LedgerErrorCode } from "@/lib/sync/errors";
import type {
  Bootstrap,
  ChargePage,
  ExpensePage,
  PageCursor,
  ChatMessage,
  ConversationReadWatermark,
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
  type ConversationMerge,
  conversationState,
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
  /** Strict boundary for the next older page; null when there is none. */
  cursor: PageCursor | null;
  complete: boolean;
  /** Server count over the whole scope; null until a page reported it. */
  total: number | null;
}

export interface ConversationReconcileState {
  status: "idle" | "loading" | "ready" | "error";
  /**
   * Newest incoming message id such that every incoming message at or before
   * it is known contiguously. Acknowledgement may never move past this.
   */
  readableThroughMessageId: string | null;
}

export interface ConversationState {
  messages: ChatMessage[];
  events: GroupEvent[];
  messageCursor: PageCursor | null;
  messagesComplete: boolean;
  eventCursor: PageCursor | null;
  eventsComplete: boolean;
  readWatermark: ConversationReadWatermark | null;
  reconcile: ConversationReconcileState;
}

export interface MyDebts {
  groupId: string;
  owes: Transfer[];
  owed: Transfer[];
}

/**
 * Lifecycle of one resource read. An error carries its code so screens can
 * explain the failure instead of rendering an empty or settled state.
 */
export type ResourceReadState =
  | { status: "idle" | "loading" | "ready" }
  | { status: "error"; code: LedgerErrorCode };

export const groupReadKey = (groupId: string) => `group:${groupId}`;
export const expenseReadKey = (expenseId: string) => `expense:${expenseId}`;
export const conversationReadKey = (groupId: string) => `conversation:${groupId}`;
export const expensePageReadKey = (groupId: string) => `expensePage:${groupId}`;
export const CHARGES_READ_KEY = "charges";
export const MY_EXPENSES_READ_KEY = "myExpenses";

/** Nothing has been attempted for this resource yet. */
export const IDLE_READ: ResourceReadState = { status: "idle" };

interface AppStateData {
  hydrated: boolean;
  me: Me | null;
  groups: Record<string, GroupSnapshot>;
  groupOrder: string[];
  expenseLists: Record<string, ExpenseListState>;
  /** Cross-group history for the bills screen, ordered by the server. */
  myExpenses: ExpenseListState;
  expenses: Record<string, ExpenseSummary>;
  expenseDetails: Record<string, ExpenseDetail>;
  activity: {
    items: GroupEvent[];
    oldestId: number | null;
    /** The server had no older rows on the last successful page. */
    complete: boolean;
    read: ResourceReadState;
  };
  /** Newest activity each account has actually seen, keyed by account id. */
  activityViewedAt: Record<string, string>;
  conversations: Record<string, ConversationState>;
  vendorCharges: VendorCharge[];
  /** Server-owned charge history metadata: cursor, totals and today's sum. */
  chargeSummary: {
    cursor: PageCursor | null;
    complete: boolean;
    total: number | null;
    receivedCount: number | null;
    receivedTodayCents: number | null;
  };
  /**
   * Read lifecycle per resource, keyed by the helpers below. Runtime only, and
   * cleared by reset(), so it is never inherited across accounts.
   */
  reads: Record<string, ResourceReadState>;
  lastBootstrapAt: string | null;
  /** Lifecycle of the bootstrap read for the currently authenticated account. */
  bootstrapStatus: "idle" | "loading" | "ready" | "error";
  bootstrapErrorCode: LedgerErrorCode | null;
  /**
   * Account whose bootstrap last committed. Persisted so a reload can tell
   * "known-good data for this account" from "some account's stale cache".
   */
  lastBootstrappedAccountId: string | null;
}

export interface AppState extends AppStateData {
  setHydrated(): void;
  applyBootstrap(b: Bootstrap, knownGroupIds?: readonly string[]): void;
  setBootstrapLoading(): void;
  setBootstrapError(code: LedgerErrorCode): void;
  applyGroup(s: GroupSnapshot): void;
  removeGroup(groupId: string): void;
  applyExpenseDetail(d: ExpenseDetail): void;
  applyExpensePage(groupId: string, page: ExpensePage): void;
  applyMyExpensePage(page: ExpensePage, reset: boolean): void;
  applyActivity(items: GroupEvent[], complete: boolean): void;
  setActivityRead(read: ResourceReadState): void;
  setResourceRead(key: string, read: ResourceReadState): void;
  markActivityViewed(accountId: string, newestAt: string): void;
  applyConversation(groupId: string, merge: ConversationMerge): void;
  setConversationReconcile(groupId: string, status: ConversationReconcileState["status"]): void;
  upsertExpense(summary: ExpenseSummary): void;
  replaceExpenseId(oldId: string, newId: string): void;
  patch(fn: (state: AppState) => Partial<AppState>): void;
  applyChargePage(page: ChargePage, reset: boolean): void;
  upsertVendorCharge(c: VendorCharge): void;
  reset(): void;
}

const initialData: AppStateData = {
  hydrated: false,
  me: null,
  groups: {},
  groupOrder: [],
  expenseLists: {},
  myExpenses: { ids: [], cursor: null, complete: false, total: null },
  expenses: {},
  expenseDetails: {},
  activity: { items: [], oldestId: null, complete: false, read: { status: "idle" } },
  activityViewedAt: {},
  conversations: {},
  vendorCharges: [],
  chargeSummary: {
    cursor: null,
    complete: false,
    total: null,
    receivedCount: null,
    receivedTodayCents: null,
  },
  reads: {},
  lastBootstrapAt: null,
  bootstrapStatus: "idle",
  bootstrapErrorCode: null,
  lastBootstrappedAccountId: null,
};

function normalizeCursor(value: unknown): PageCursor | null {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (record === null || typeof record.createdAt !== "string" || typeof record.id !== "string") {
    return null;
  }
  return { createdAt: record.createdAt, id: record.id };
}

function normalizeExpenseList(value: unknown): ExpenseListState {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const ids = Array.isArray(record.ids)
    ? record.ids.filter((id): id is string => typeof id === "string")
    : [];
  const complete = typeof record.complete === "boolean" ? record.complete : false;
  const total =
    typeof record.total === "number" && Number.isInteger(record.total) && record.total >= 0
      ? record.total
      : null;
  return {
    ids,
    cursor: normalizeCursor(record.cursor ?? record.oldestCursor),
    complete,
    total,
  };
}


function normalizeConversationReconcile(value: unknown): ConversationReconcileState {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return {
    status: "idle",
    readableThroughMessageId:
      record !== null && typeof record.readableThroughMessageId === "string"
        ? record.readableThroughMessageId
        : null,
  };
}

export function migrateAppState(persisted: unknown): AppStateData {
  const root =
    persisted !== null && typeof persisted === "object" && !Array.isArray(persisted)
      ? (persisted as Record<string, unknown>)
      : {};
  const legacy = root as Partial<AppStateData>;
  const groups: Record<string, GroupSnapshot> = {};
  const persistedGroups =
    root.groups !== null && typeof root.groups === "object" && !Array.isArray(root.groups)
      ? (root.groups as Record<string, unknown>)
      : {};
  for (const [id, value] of Object.entries(persistedGroups)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const snapshot = value as GroupSnapshot;
    groups[id] = {
      ...snapshot,
      expenseCount: snapshot.expenseCount ?? 0,
      pairwiseEdges: snapshot.pairwiseEdges ?? [],
    };
  }

  const expenseLists: Record<string, ExpenseListState> = {};
  const persistedExpenseLists =
    root.expenseLists !== null &&
    typeof root.expenseLists === "object" &&
    !Array.isArray(root.expenseLists)
      ? (root.expenseLists as Record<string, unknown>)
      : {};
  for (const [groupId, value] of Object.entries(persistedExpenseLists)) {
    expenseLists[groupId] = normalizeExpenseList(value);
  }

  const persistedActivity =
    root.activity !== null && typeof root.activity === "object" && !Array.isArray(root.activity)
      ? (root.activity as Record<string, unknown>)
      : {};
  const activity: AppStateData["activity"] = {
    items: Array.isArray(persistedActivity.items)
      ? (persistedActivity.items as GroupEvent[])
      : [],
    oldestId: typeof persistedActivity.oldestId === "number" ? persistedActivity.oldestId : null,
    complete: typeof persistedActivity.complete === "boolean" ? persistedActivity.complete : false,
    read: { status: "idle" },
  };

  const conversations: Record<string, ConversationState> = {};
  const persistedConversations =
    root.conversations !== null &&
    typeof root.conversations === "object" &&
    !Array.isArray(root.conversations)
      ? (root.conversations as Record<string, unknown>)
      : {};
  for (const [groupId, value] of Object.entries(persistedConversations)) {
    const cached =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Partial<ConversationState>)
        : {};
    const messages = Array.isArray(cached.messages) ? (cached.messages as ChatMessage[]) : [];
    const events = Array.isArray(cached.events) ? (cached.events as GroupEvent[]) : [];
    const paired =
      cached.messagesComplete !== undefined && cached.eventsComplete !== undefined;
    conversations[groupId] = paired
      ? conversationState({
          ...cached,
          messages,
          events,
          messageCursor: normalizeCursor(cached.messageCursor),
          eventCursor: normalizeCursor(cached.eventCursor),
          messagesComplete: cached.messagesComplete === true,
          eventsComplete: cached.eventsComplete === true,
          reconcile: normalizeConversationReconcile(cached.reconcile),
        })
      : conversationState({
          messages,
          events,
          messageCursor: null,
          messagesComplete: false,
          eventCursor: null,
          eventsComplete: false,
          readWatermark: null,
          reconcile: { status: "idle", readableThroughMessageId: null },
        });
  }

  const persistedExpenses =
    root.expenses !== null && typeof root.expenses === "object" && !Array.isArray(root.expenses)
      ? (root.expenses as Record<string, ExpenseSummary>)
      : {};
  const persistedExpenseDetails =
    root.expenseDetails !== null &&
    typeof root.expenseDetails === "object" &&
    !Array.isArray(root.expenseDetails)
      ? (root.expenseDetails as Record<string, ExpenseDetail>)
      : {};
  const groupOrder = Array.isArray(root.groupOrder)
    ? root.groupOrder.filter((id): id is string => typeof id === "string")
    : [];
  const activityViewedAt =
    root.activityViewedAt !== null &&
    typeof root.activityViewedAt === "object" &&
    !Array.isArray(root.activityViewedAt)
      ? Object.fromEntries(
          Object.entries(root.activityViewedAt).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const chargeSummary =
    root.chargeSummary !== null &&
    typeof root.chargeSummary === "object" &&
    !Array.isArray(root.chargeSummary)
      ? {
          ...initialData.chargeSummary,
          ...(root.chargeSummary as Partial<AppStateData["chargeSummary"]>),
        }
      : initialData.chargeSummary;

  return {
    ...initialData,
    me: legacy.me ?? null,
    groups,
    groupOrder,
    expenseLists,
    myExpenses: normalizeExpenseList(root.myExpenses),
    expenses: persistedExpenses,
    expenseDetails: persistedExpenseDetails,
    activity,
    activityViewedAt,
    conversations,
    vendorCharges: Array.isArray(root.vendorCharges)
      ? (root.vendorCharges as VendorCharge[])
      : [],
    chargeSummary,
    lastBootstrapAt: typeof legacy.lastBootstrapAt === "string" ? legacy.lastBootstrapAt : null,
    lastBootstrappedAccountId:
      typeof legacy.lastBootstrappedAccountId === "string"
        ? legacy.lastBootstrappedAccountId
        : null,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialData,
      setHydrated: () => set({ hydrated: true }),

      applyBootstrap: (b, knownGroupIds) =>
        set((state) => {
          const groups: Record<string, GroupSnapshot> = {};
          const expenseLists: Record<string, ExpenseListState> = {};
          const conversations: Record<string, ConversationState> = {};
          // Only groups the response actually won are allowed to contribute
          // expense summaries, so a stale snapshot cannot seed the map with
          // rows this store already superseded.
          let expenses = state.expenses;

          // Groups the caller had before the request started. Anything created
          // locally afterwards is newer than the response and is preserved;
          // anything removed afterwards must not be resurrected.
          const atRequestStart = knownGroupIds === undefined ? null : new Set(knownGroupIds);

          for (const snapshot of b.groups) {
            const id = snapshot.group.id;
            const current = state.groups[id];

            if (atRequestStart !== null && atRequestStart.has(id) && current === undefined) {
              // It existed when the request left and is gone now, so it was
              // removed locally afterwards: this response predates that.
              continue;
            }

            if (current !== undefined && snapshot.group.ledgerVersion < current.group.ledgerVersion) {
              // The response is older than what this store already holds, so
              // every slice derived from it stays as-is.
              groups[id] = current;
              const currentList = state.expenseLists[id];
              if (currentList !== undefined) expenseLists[id] = currentList;
              const currentConversation = state.conversations[id];
              if (currentConversation !== undefined) conversations[id] = currentConversation;
              continue;
            }

            expenses = upsertSummaries(expenses, snapshot.recentExpenses);
            groups[id] = snapshot;
            expenseLists[id] = listFromSeed(state.expenseLists[id], snapshot.recentExpenses);
            conversations[id] = state.conversations[id] ?? conversationState();
          }

          // Groups created locally after the request started are not in the
          // response yet, but they are newer than it.
          if (atRequestStart !== null) {
            for (const [id, snapshot] of Object.entries(state.groups)) {
              if (groups[id] !== undefined || atRequestStart.has(id)) continue;
              groups[id] = snapshot;
              const currentList = state.expenseLists[id];
              if (currentList !== undefined) expenseLists[id] = currentList;
              const currentConversation = state.conversations[id];
              if (currentConversation !== undefined) conversations[id] = currentConversation;
            }
          }

          return {
            me: b.me,
            groups,
            groupOrder: computeGroupOrder(groups),
            expenseLists,
            conversations,
            expenses,
            lastBootstrapAt: new Date().toISOString(),
            bootstrapStatus: "ready" as const,
            bootstrapErrorCode: null,
            lastBootstrappedAccountId: b.me.id,
          };
        }),

      setBootstrapLoading: () =>
        set((state) => ({
          bootstrapStatus: "loading" as const,
          bootstrapErrorCode: state.bootstrapStatus === "error" ? null : state.bootstrapErrorCode,
        })),

      // Failure records why without clearing projections: known-good data
      // stays on screen behind a retryable warning.
      setBootstrapError: (code) =>
        set({ bootstrapStatus: "error" as const, bootstrapErrorCode: code }),

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
              [id]: listFromSeed(state.expenseLists[id], s.recentExpenses),
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

      applyExpensePage: (groupId, page) =>
        set((state) => ({
          expenses: upsertSummaries(state.expenses, page.expenses),
          expenseLists: {
            ...state.expenseLists,
            [groupId]: appendPage(state.expenseLists[groupId], page),
          },
        })),

      applyMyExpensePage: (page, reset) =>
        set((state) => ({
          expenses: upsertSummaries(state.expenses, page.expenses),
          // A head load reseeds the list; an older page extends it.
          myExpenses: appendPage(reset ? undefined : state.myExpenses, page),
        })),

      // Rows are published only from a successful read, so a failure can never
      // shrink the list or mark it complete.
      applyActivity: (items, complete) =>
        set((state) => ({
          activity: {
            ...mergeActivity(state.activity.items, items),
            complete,
            read: { status: "ready" as const },
          },
        })),

      setActivityRead: (read) =>
        set((state) => ({ activity: { ...state.activity, read } })),

      setResourceRead: (key, read) =>
        set((state) => ({ reads: { ...state.reads, [key]: read } })),

      markActivityViewed: (accountId, newestAt) =>
        set((state) => ({
          activityViewedAt: { ...state.activityViewedAt, [accountId]: newestAt },
        })),

      applyConversation: (groupId, merge) =>
        set((state) => ({
          conversations: {
            ...state.conversations,
            [groupId]: mergeConversation(
              state.conversations[groupId],
              merge,
              state.me?.id ?? null,
            ),
          },
        })),

      setConversationReconcile: (groupId, status) =>
        set((state) => {
          const conversation = state.conversations[groupId];
          if (conversation === undefined) return {};
          return {
            conversations: {
              ...state.conversations,
              [groupId]: { ...conversation, reconcile: { ...conversation.reconcile, status } },
            },
          };
        }),

      upsertExpense: (summary) =>
        set((state) => {
          const list = state.expenseLists[summary.groupId] ?? {
            ids: [],
            cursor: null,
            complete: false,
            total: null,
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
      applyChargePage: (page, reset) =>
        set((state) => {
          const known = new Set(reset ? [] : state.vendorCharges.map((c) => c.id));
          const rows = reset ? [] : state.vendorCharges;
          return {
            vendorCharges: [...rows, ...page.charges.filter((c) => !known.has(c.id))],
            chargeSummary: {
              cursor: page.nextCursor,
              complete: page.complete,
              total: page.total,
              receivedCount: page.receivedCount,
              receivedTodayCents: page.receivedTodayCents,
            },
          };
        }),

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
        myExpenses: state.myExpenses,
        expenses: state.expenses,
        expenseDetails: state.expenseDetails,
        activity: state.activity,
        activityViewedAt: state.activityViewedAt,
        conversations: state.conversations,
        vendorCharges: state.vendorCharges,
        chargeSummary: state.chargeSummary,
        lastBootstrapAt: state.lastBootstrapAt,
        lastBootstrappedAccountId: state.lastBootstrappedAccountId,
      }),
      onRehydrateStorage: () => () => {
        useAppStore.setState({ hydrated: true });
      },
      skipHydration: true,
      migrate: migrateAppState,
      version: 3,
    },
  ),
);

