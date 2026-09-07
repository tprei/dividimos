import { applyExpenseDelta, applySettlementDelta } from "@/lib/ledger/apply";
import { decodeChatMessage, decodeMutationAck } from "@/lib/ledger/decode";
import { rpc, rpcVoid } from "@/lib/sync/client";
import { LedgerError } from "@/lib/sync/errors";
import { refreshExpense, refreshGroup } from "@/lib/sync/refresh";
import type { ConversationState, ExpenseListState } from "@/stores/app-store";
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

interface PriorState {
  expenses: Record<string, ExpenseSummary>;
  expenseDetails: Record<string, ExpenseDetail>;
  expenseLists: Record<string, ExpenseListState>;
  groups: Record<string, GroupSnapshot>;
  conversations: Record<string, ConversationState>;
}

function capturePriorState(): PriorState {
  const s = useAppStore.getState();
  return {
    expenses: s.expenses,
    expenseDetails: s.expenseDetails,
    expenseLists: s.expenseLists,
    groups: s.groups,
    conversations: s.conversations,
  };
}

function restorePriorState(p: PriorState): void {
  useAppStore.getState().patch(() => ({
    expenses: p.expenses,
    expenseDetails: p.expenseDetails,
    expenseLists: p.expenseLists,
    groups: p.groups,
    conversations: p.conversations,
  }));
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

function findSettlementInEvents(
  groupId: string,
  settlementId: string,
): { fromUserId: string; toUserId: string; amountCents: number } | null {
  const s = useAppStore.getState();
  const events = [...(s.conversations[groupId]?.events ?? []), ...s.activity.items];
  for (const ev of events) {
    if (ev.settlementId === settlementId && ev.payload) {
      const { fromUserId, toUserId, amountCents } = ev.payload;
      if (typeof fromUserId === "string" && typeof toUserId === "string" && typeof amountCents === "number") {
        return { fromUserId, toUserId, amountCents };
      }
    }
  }
  return null;
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
}): Promise<MutationAck> {
  const { groupId, header, payload } = input;
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const prior = capturePriorState();
  const clientId = crypto.randomUUID();
  const { myShareCents, myPaidCents } = computeMyShareAndPaid(payload, me.id);

  store.upsertExpense({
    id: clientId,
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
  });

  const group = store.groups[groupId];
  if (group) {
    const balances = applyExpenseDelta(group.balances, payload, 1);
    store.patch((s) => ({
      groups: s.groups[groupId] ? { ...s.groups, [groupId]: { ...s.groups[groupId], balances } } : s.groups,
    }));
  }

  try {
    const ack = await rpc(
      "create_expense",
      {
        p_client_id: clientId,
        p_group_id: groupId,
        p_occurred_on: header.occurredOn,
        p_title: header.title,
        p_merchant_name: header.merchantName,
        p_expense_type: header.expenseType,
        p_total_cents: header.totalCents,
        p_service_fee_bps: header.serviceFeeBasisPoints,
        p_fixed_fee_cents: header.fixedFeeCents,
        p_payload: payload,
      },
      decodeMutationAck,
    );
    if (ack.expenseId) useAppStore.getState().replaceExpenseId(clientId, ack.expenseId);
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
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

  const prior = capturePriorState();
  const detail = store.expenseDetails[expenseId];
  const summary = store.expenses[expenseId];
  const groupId = detail?.expense.groupId ?? summary?.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (group && detail?.current.payload) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, -1);
    balances = applyExpenseDelta(balances, payload, 1);
  }

  const { myShareCents, myPaidCents } = computeMyShareAndPaid(payload, me.id);
  store.patch((s) => ({
    ...(summary
      ? {
          expenses: {
            ...s.expenses,
            [expenseId]: {
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
            },
          },
        }
      : {}),
    ...(groupId && group && balances
      ? { groups: { ...s.groups, [groupId]: { ...s.groups[groupId], balances } } }
      : {}),
  }));

  try {
    const ack = await rpc(
      "edit_expense",
      {
        p_expense_id: expenseId,
        p_expected_version_no: expectedVersionNo,
        p_occurred_on: header.occurredOn,
        p_title: header.title,
        p_merchant_name: header.merchantName,
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
    restorePriorState(prior);
    throw error;
  }
}

export async function deleteExpense(expenseId: string): Promise<MutationAck> {
  const store = useAppStore.getState();
  const prior = capturePriorState();
  const summary = store.expenses[expenseId];
  const detail = store.expenseDetails[expenseId];
  const groupId = summary?.groupId ?? detail?.expense.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (group && detail?.current.payload) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, -1);
  }

  store.patch((s) => ({
    ...(summary ? { expenses: { ...s.expenses, [expenseId]: { ...summary, status: "deleted" } } } : {}),
    ...(detail
      ? { expenseDetails: { ...s.expenseDetails, [expenseId]: { ...detail, expense: { ...detail.expense, status: "deleted" } } } }
      : {}),
    ...(groupId && group && balances
      ? { groups: { ...s.groups, [groupId]: { ...s.groups[groupId], balances } } }
      : {}),
  }));

  try {
    const ack = await rpc("delete_expense", { p_expense_id: expenseId }, decodeMutationAck);
    void refreshExpense(expenseId);
    void refreshGroup(ack.groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}

export async function restoreExpense(expenseId: string): Promise<MutationAck> {
  const store = useAppStore.getState();
  const prior = capturePriorState();
  const summary = store.expenses[expenseId];
  const detail = store.expenseDetails[expenseId];
  const groupId = summary?.groupId ?? detail?.expense.groupId;
  const group = groupId ? store.groups[groupId] : undefined;

  let balances = group?.balances;
  if (group && detail?.current.payload) {
    balances = applyExpenseDelta(group.balances, detail.current.payload, 1);
  }

  store.patch((s) => ({
    ...(summary ? { expenses: { ...s.expenses, [expenseId]: { ...summary, status: "active" } } } : {}),
    ...(detail
      ? { expenseDetails: { ...s.expenseDetails, [expenseId]: { ...detail, expense: { ...detail.expense, status: "active" } } } }
      : {}),
    ...(groupId && group && balances
      ? { groups: { ...s.groups, [groupId]: { ...s.groups[groupId], balances } } }
      : {}),
  }));

  try {
    const ack = await rpc("restore_expense", { p_expense_id: expenseId }, decodeMutationAck);
    void refreshExpense(expenseId);
    void refreshGroup(ack.groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}

export async function recordSettlement(input: {
  groupId: string;
  toUserId: string;
  amountCents: number;
}): Promise<MutationAck> {
  const { groupId, toUserId, amountCents } = input;
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const prior = capturePriorState();
  const operationId = crypto.randomUUID();

  const optimistic: Settlement = {
    id: operationId,
    operationId,
    groupId,
    fromUserId: me.id,
    toUserId,
    amountCents,
    status: "pending",
    createdBy: me.id,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    voidedAt: null,
    voidedBy: null,
  };

  store.patch((s) => {
    const group = s.groups[groupId];
    if (!group) return {};
    return {
      groups: { ...s.groups, [groupId]: { ...group, pendingSettlements: [...group.pendingSettlements, optimistic] } },
    };
  });

  try {
    const ack = await rpc(
      "record_settlement",
      {
        p_operation_id: operationId,
        p_group_id: groupId,
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
              pendingSettlements: group.pendingSettlements.map((item) =>
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
    restorePriorState(prior);
    throw error;
  }
}

export async function confirmSettlement(groupId: string, settlementId: string): Promise<MutationAck> {
  const store = useAppStore.getState();
  const prior = capturePriorState();
  const group = store.groups[groupId];
  const settlement = group?.pendingSettlements.find((s) => s.id === settlementId);

  if (group && settlement) {
    const pendingSettlements = group.pendingSettlements.filter((s) => s.id !== settlementId);
    const balances = applySettlementDelta(group.balances, settlement, 1);
    store.patch((s) => ({
      groups: s.groups[groupId]
        ? { ...s.groups, [groupId]: { ...s.groups[groupId], pendingSettlements, balances } }
        : s.groups,
    }));
  }

  try {
    const ack = await rpc("confirm_settlement", { p_settlement_id: settlementId }, decodeMutationAck);
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}

export async function voidSettlement(
  groupId: string,
  settlementId: string,
  wasConfirmed: boolean,
): Promise<MutationAck> {
  const store = useAppStore.getState();
  const prior = capturePriorState();
  const group = store.groups[groupId];

  if (group) {
    const pendingSettlements = group.pendingSettlements.filter((s) => s.id !== settlementId);
    let balances = group.balances;
    if (wasConfirmed) {
      const parts = findSettlementInEvents(groupId, settlementId);
      if (parts) balances = applySettlementDelta(group.balances, parts, -1);
    }
    store.patch((s) => ({
      groups: s.groups[groupId]
        ? { ...s.groups, [groupId]: { ...s.groups[groupId], pendingSettlements, balances } }
        : s.groups,
    }));
  }

  try {
    const ack = await rpc("void_settlement", { p_settlement_id: settlementId }, decodeMutationAck);
    void refreshGroup(groupId);
    notify(ack.eventId);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}

export async function sendMessage(groupId: string, content: string): Promise<ChatMessage> {
  const store = useAppStore.getState();
  const me = store.me;
  if (!me) throw new LedgerError("unauthenticated");

  const prior = capturePriorState();
  const clientId = crypto.randomUUID();

  store.applyConversation(
    groupId,
    {
      messages: [
        {
          id: clientId,
          clientId,
          groupId,
          senderId: me.id,
          content,
          createdAt: new Date().toISOString(),
          sender: { id: me.id, handle: me.handle, name: me.name, avatarUrl: me.avatarUrl },
        },
      ],
      events: [],
    },
    false,
  );

  try {
    const ack = await rpc(
      "send_message",
      { p_client_id: clientId, p_group_id: groupId, p_content: content },
      decodeChatMessage,
    );
    useAppStore.getState().applyConversation(groupId, { messages: [ack], events: [] }, false);
    return ack;
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}

export async function markRead(groupId: string): Promise<void> {
  const store = useAppStore.getState();
  const prior = capturePriorState();

  store.patch((s) => {
    const group = s.groups[groupId];
    if (!group) return {};
    return { groups: { ...s.groups, [groupId]: { ...group, unreadCount: 0 } } };
  });

  try {
    await rpcVoid("mark_read", { p_group_id: groupId });
  } catch (error) {
    restorePriorState(prior);
    throw error;
  }
}
