import { applyExpenseDelta, applySettlementDelta, hasUnresolvedParticipants } from "@/lib/ledger/apply";
import { decodeChatMessage, decodeMutationAck } from "@/lib/ledger/decode";
import { rpc, rpcVoid } from "@/lib/sync/client";
import { LedgerError } from "@/lib/sync/errors";
import { loadConversation, refreshExpense, refreshGroup } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type {
  ChatMessage,
  ExpenseDetail,
  ExpenseHeader,
  ExpensePayload,
  ExpenseSummary,
  GroupSnapshot,
  MutationAck,
  Settlement,
} from "@/types/ledger";

const RECONCILE_MAX_ATTEMPTS = 4;
const RECONCILE_BACKOFF_MS = 500;

/** The refresh that should converge the store usually lands in the same network flap that failed the mutation, so without retries a wrong balance can stay on screen until the next broadcast or reload. */
async function reconcileWithRetry(
  reconcile: (groupId: string) => Promise<void>,
  groupId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await reconcile(groupId);
      return;
    } catch {
      if (attempt === RECONCILE_MAX_ATTEMPTS) return;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RECONCILE_BACKOFF_MS * 2 ** (attempt - 1));
      await promise;
    }
  }
}

type RollbackStep = () => void;

/** Restores `prior` only while the store still holds the entry this mutation wrote — a concurrent server refresh replaces it and wins. */
function revertGroup(groupId: string, patched: GroupSnapshot, prior: GroupSnapshot): RollbackStep {
  return () => {
    if (useAppStore.getState().groups[groupId] !== patched) return;
    useAppStore.getState().patch((s) => ({ groups: { ...s.groups, [groupId]: prior } }));
  };
}

function revertExpenseSummary(expenseId: string, patched: ExpenseSummary, prior: ExpenseSummary): RollbackStep {
  return () => {
    if (useAppStore.getState().expenses[expenseId] !== patched) return;
    useAppStore.getState().patch((s) => ({ expenses: { ...s.expenses, [expenseId]: prior } }));
  };
}

function revertExpenseDetail(expenseId: string, patched: ExpenseDetail, prior: ExpenseDetail): RollbackStep {
  return () => {
    if (useAppStore.getState().expenseDetails[expenseId] !== patched) return;
    useAppStore.getState().patch((s) => ({ expenseDetails: { ...s.expenseDetails, [expenseId]: prior } }));
  };
}

function removeOptimisticExpense(
  clientId: string,
  groupId: string,
  patched: ExpenseSummary,
): RollbackStep {
  return () => {
    useAppStore.getState().patch((s) => {
      if (s.expenses[clientId] !== patched || patched.groupId !== groupId) return {};
      const expenses = { ...s.expenses };
      delete expenses[clientId];
      const list = s.expenseLists[groupId];
      return {
        expenses,
        expenseLists: list
          ? { ...s.expenseLists, [groupId]: { ...list, ids: list.ids.filter((id) => id !== clientId) } }
          : s.expenseLists,
      };
    });
  };
}

function removeOptimisticMessage(groupId: string, clientId: string): RollbackStep {
  return () => {
    useAppStore.getState().patch((s) => {
      const conversation = s.conversations[groupId];
      if (!conversation) return {};
      const messages = conversation.messages.filter((m) => m.clientId !== clientId);
      if (messages.length === conversation.messages.length) return {};
      return {
        conversations: { ...s.conversations, [groupId]: { ...conversation, messages } },
      };
    });
  };
}

function rollbackAndReconcile(
  rollback: RollbackStep[],
  groupId: string | undefined,
  error: unknown,
  reconcile: (groupId: string) => Promise<void>,
): never {
  for (const step of rollback) step();
  if (groupId) void reconcileWithRetry(reconcile, groupId);
  throw error;
}

function computeMyShareAndPaid(
  payload: ExpensePayload,
  meId: string | undefined,
): { myShareCents: number; myPaidCents: number } {
  if (!meId) return { myShareCents: 0, myPaidCents: 0 };
  const idx = payload.participants.findIndex((p) => p.kind === "user" && p.userId === meId);
  if (idx === -1) return { myShareCents: 0, myPaidCents: 0 };
  let myPaidCents = 0;
  for (const payer of payload.payers) {
    if (payer.participantIndex === idx) myPaidCents += payer.amountCents;
  }
  return { myShareCents: payload.shares[idx] ?? 0, myPaidCents };
}

export function notify(eventId: number | null): void {
  if (eventId === null) return;
  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function createExpense(input: {
  groupId: string;
  header: ExpenseHeader;
  payload: ExpensePayload;
  clientId?: string;
}): Promise<MutationAck> {
  const { groupId, header, payload } = input;
  const creationClientId = input.clientId ?? crypto.randomUUID();
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const { myShareCents, myPaidCents } = computeMyShareAndPaid(payload, me.id);
  const optimisticExpense: ExpenseSummary = {
    id: creationClientId,
    groupId,
    creatorId: me.id,
    status: "active",
    occurredOn: header.occurredOn,
    createdAt: new Date().toISOString(),
    versionNo: 1,
    title: header.title,
    merchantName: header.merchantName,
    expenseType: header.expenseType,
    totalCents: header.totalCents,
    myShareCents,
    myPaidCents,
    participantCount: payload.participants.length,
  };
  const rollback: RollbackStep[] = [
    removeOptimisticExpense(creationClientId, groupId, optimisticExpense),
  ];

  store.upsertExpense(optimisticExpense);
  const priorGroup = store.groups[groupId];
  if (priorGroup) {
    const patchedGroup: GroupSnapshot = {
      ...priorGroup,
      balances: applyExpenseDelta(priorGroup.balances, payload, 1),
    };
    store.patch((s) => ({
      groups: s.groups[groupId] ? { ...s.groups, [groupId]: patchedGroup } : s.groups,
    }));
    rollback.push(revertGroup(groupId, patchedGroup, priorGroup));
  }

  try {
    const ack = await rpc(
      "create_expense",
      {
        p_client_id: creationClientId,
        p_group_id: groupId,
        p_occurred_on: header.occurredOn,
        p_title: header.title,
        p_merchant_name: header.merchantName ?? "",
        p_expense_type: header.expenseType,
        p_total_cents: header.totalCents,
        p_service_fee_bps: header.serviceFeeBasisPoints,
        p_fixed_fee_cents: header.fixedFeeCents,
        p_payload: payload,
        p_chave_acesso: header.receiptAccessKey ?? null,
      },
      decodeMutationAck,
    );
    if (ack.expenseId) {
      useAppStore.getState().replaceExpenseId(creationClientId, ack.expenseId);
    }
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}

export async function editExpense(input: {
  expenseId: string;
  expectedVersionNo: number;
  header: ExpenseHeader;
  payload: ExpensePayload;
}): Promise<MutationAck> {
  const { expenseId, expectedVersionNo, header, payload } = input;
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const detail = store.expenseDetails[expenseId];
  const summary = store.expenses[expenseId];
  const groupId = detail?.expense.groupId ?? summary?.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (
    group &&
    detail?.current.payload &&
    !hasUnresolvedParticipants(detail.current.payload) &&
    !hasUnresolvedParticipants(payload)
  ) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, -1);
    balances = applyExpenseDelta(balances, payload, 1);
  }

  const { myShareCents, myPaidCents } = computeMyShareAndPaid(payload, me.id);

  const patchedSummary: ExpenseSummary | null = summary
    ? {
        ...summary,
        occurredOn: header.occurredOn,
        versionNo: expectedVersionNo + 1,
        title: header.title,
        merchantName: header.merchantName,
        expenseType: header.expenseType,
        totalCents: header.totalCents,
        myShareCents,
        myPaidCents,
        participantCount: payload.participants.length,
      }
    : null;
  const patchedGroup = groupId && group && balances ? { ...group, balances } : null;

  const rollback: RollbackStep[] = [];
  store.patch((s) => ({
    ...(patchedSummary ? { expenses: { ...s.expenses, [expenseId]: patchedSummary } } : {}),
    ...(patchedGroup && groupId ? { groups: { ...s.groups, [groupId]: patchedGroup } } : {}),
  }));
  if (patchedSummary && summary) rollback.push(revertExpenseSummary(expenseId, patchedSummary, summary));
  if (patchedGroup && group && groupId) rollback.push(revertGroup(groupId, patchedGroup, group));

  try {
    const ack = await rpc(
      "edit_expense",
      {
        p_expense_id: expenseId,
        p_expected_version_no: expectedVersionNo,
        p_occurred_on: header.occurredOn,
        p_title: header.title,
        p_merchant_name: header.merchantName ?? "",
        p_expense_type: header.expenseType,
        p_total_cents: header.totalCents,
        p_service_fee_bps: header.serviceFeeBasisPoints,
        p_fixed_fee_cents: header.fixedFeeCents,
        p_payload: payload,
      },
      decodeMutationAck,
    );
    void refreshExpense(expenseId);
    void refreshGroup(ack.groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}

export async function deleteExpense(expenseId: string): Promise<MutationAck> {
  const store = useAppStore.getState();
  const summary = store.expenses[expenseId];
  const detail = store.expenseDetails[expenseId];
  const groupId = summary?.groupId ?? detail?.expense.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (group && detail?.current.payload) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, -1);
  }

  const patchedSummary: ExpenseSummary | null = summary ? { ...summary, status: "deleted" } : null;
  const patchedDetail: ExpenseDetail | null = detail
    ? { ...detail, expense: { ...detail.expense, status: "deleted" } }
    : null;
  const patchedGroup = groupId && group && balances ? { ...group, balances } : null;

  const rollback: RollbackStep[] = [];
  store.patch((s) => ({
    ...(patchedSummary ? { expenses: { ...s.expenses, [expenseId]: patchedSummary } } : {}),
    ...(patchedDetail ? { expenseDetails: { ...s.expenseDetails, [expenseId]: patchedDetail } } : {}),
    ...(patchedGroup && groupId ? { groups: { ...s.groups, [groupId]: patchedGroup } } : {}),
  }));
  if (patchedSummary && summary) rollback.push(revertExpenseSummary(expenseId, patchedSummary, summary));
  if (patchedDetail && detail) rollback.push(revertExpenseDetail(expenseId, patchedDetail, detail));
  if (patchedGroup && group && groupId) rollback.push(revertGroup(groupId, patchedGroup, group));

  try {
    const ack = await rpc("delete_expense", { p_expense_id: expenseId }, decodeMutationAck);
    void refreshExpense(expenseId);
    void refreshGroup(ack.groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}

export async function restoreExpense(expenseId: string): Promise<MutationAck> {
  const store = useAppStore.getState();
  const summary = store.expenses[expenseId];
  const detail = store.expenseDetails[expenseId];
  const groupId = summary?.groupId ?? detail?.expense.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (group && detail?.current.payload) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, 1);
  }

  const patchedSummary: ExpenseSummary | null = summary ? { ...summary, status: "active" } : null;
  const patchedDetail: ExpenseDetail | null = detail
    ? { ...detail, expense: { ...detail.expense, status: "active" } }
    : null;
  const patchedGroup = groupId && group && balances ? { ...group, balances } : null;

  const rollback: RollbackStep[] = [];
  store.patch((s) => ({
    ...(patchedSummary ? { expenses: { ...s.expenses, [expenseId]: patchedSummary } } : {}),
    ...(patchedDetail ? { expenseDetails: { ...s.expenseDetails, [expenseId]: patchedDetail } } : {}),
    ...(patchedGroup && groupId ? { groups: { ...s.groups, [groupId]: patchedGroup } } : {}),
  }));
  if (patchedSummary && summary) rollback.push(revertExpenseSummary(expenseId, patchedSummary, summary));
  if (patchedDetail && detail) rollback.push(revertExpenseDetail(expenseId, patchedDetail, detail));
  if (patchedGroup && group && groupId) rollback.push(revertGroup(groupId, patchedGroup, group));

  try {
    const ack = await rpc("restore_expense", { p_expense_id: expenseId }, decodeMutationAck);
    void refreshExpense(expenseId);
    void refreshGroup(ack.groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}

export async function recordSettlement(input: {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}): Promise<MutationAck> {
  const { groupId, fromUserId, toUserId, amountCents } = input;
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const optimistic: Settlement = {
    id: operationId,
    operationId,
    groupId,
    fromUserId,
    toUserId,
    amountCents,
    status: "confirmed",
    createdBy: me.id,
    createdAt: now,
    confirmedAt: now,
    voidedAt: null,
    voidedBy: null,
  };

  const rollback: RollbackStep[] = [];
  const priorGroup = store.groups[groupId];
  if (priorGroup) {
    const patchedGroup: GroupSnapshot = {
      ...priorGroup,
      settlements: [...priorGroup.settlements, optimistic],
      balances: applySettlementDelta(priorGroup.balances, optimistic, 1),
    };
    store.patch((s) => ({
      groups: s.groups[groupId] ? { ...s.groups, [groupId]: patchedGroup } : s.groups,
    }));
    rollback.push(revertGroup(groupId, patchedGroup, priorGroup));
  }

  try {
    const ack = await rpc(
      "record_settlement",
      {
        p_operation_id: operationId,
        p_group_id: groupId,
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
        p_amount_cents: amountCents,
      },
      decodeMutationAck,
    );
    const settlementId = ack.settlementId;
    if (settlementId) {
      useAppStore.getState().patch((s) => {
        const group = s.groups[groupId];
        if (!group) return {};
        return {
          groups: {
            ...s.groups,
            [groupId]: {
              ...group,
              settlements: group.settlements.map((item) =>
                item.id === operationId ? { ...item, id: settlementId } : item,
              ),
            },
          },
        };
      });
    }
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}


export async function voidSettlement(
  groupId: string,
  settlementId: string,
): Promise<MutationAck> {
  const store = useAppStore.getState();
  const priorGroup = store.groups[groupId];

  const rollback: RollbackStep[] = [];
  if (priorGroup) {
    const applied = priorGroup.settlements.find((s) => s.id === settlementId);
    const balances = applied
      ? applySettlementDelta(priorGroup.balances, applied, -1)
      : priorGroup.balances;
    const patchedGroup: GroupSnapshot = {
      ...priorGroup,
      settlements: priorGroup.settlements.filter((s) => s.id !== settlementId),
      balances,
    };
    store.patch((s) => ({
      groups: s.groups[groupId] ? { ...s.groups, [groupId]: patchedGroup } : s.groups,
    }));
    rollback.push(revertGroup(groupId, patchedGroup, priorGroup));
  }

  try {
    const ack = await rpc("void_settlement", { p_settlement_id: settlementId }, decodeMutationAck);
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    rollbackAndReconcile(rollback, groupId, error, refreshGroup);
  }
}


/** Reconciler shape for rollbackAndReconcile: reloads the newest page. */
async function reloadConversation(groupId: string): Promise<void> {
  await loadConversation(groupId);
}
/**
 * Provisional timestamp for an optimistic row. Server rows carry microsecond
 * precision, so a millisecond `Date` string would sort ambiguously against
 * them; the counter keeps successive local sends strictly ordered.
 */
let optimisticCounter = 0;

function optimisticCreatedAt(): string {
  optimisticCounter = (optimisticCounter + 1) % 1000;
  const now = new Date();
  const micros = String(optimisticCounter).padStart(3, "0");
  return `${now.toISOString().slice(0, 23)}${micros}Z`;
}

export async function sendMessage(groupId: string, content: string): Promise<ChatMessage> {
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const clientId = crypto.randomUUID();

  store.applyConversation(groupId, {
    kind: "broadcast",
    messages: [
      {
        id: clientId,
        clientId,
        groupId,
        senderId: me.id,
        content,
        createdAt: optimisticCreatedAt(),
        sender: { id: me.id, handle: me.handle, name: me.name, avatarUrl: me.avatarUrl },
      },
    ],
    events: [],
  });

  try {
    const ack = await rpc(
      "send_message",
      { p_client_id: clientId, p_group_id: groupId, p_content: content },
      decodeChatMessage,
    );
    // The shared reducer keys by clientId, so this replaces the provisional
    // row rather than adding a duplicate.
    useAppStore
      .getState()
      .applyConversation(groupId, { kind: "broadcast", messages: [ack], events: [] });
    return ack;
  } catch (error) {
    rollbackAndReconcile([removeOptimisticMessage(groupId, clientId)], groupId, error, reloadConversation);
  }
}

export async function markRead(groupId: string, lastReadMessageId: string): Promise<void> {
  try {
    await rpcVoid("mark_read", {
      p_group_id: groupId,
      p_last_read_message_id: lastReadMessageId,
    });
    await refreshGroup(groupId);
  } catch (error) {
    rollbackAndReconcile([], groupId, error, refreshGroup);
  }
}
