import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import { allocateEvenly } from "@/lib/expense-money";
import type { ExpenseHeader, ExpensePayload, Me, UserProfile } from "@/types/ledger";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dmExpenseHeader(
  title: string,
  totalCents: number,
  merchantName: string | null,
): ExpenseHeader {
  return {
    occurredOn: todayIso(),
    title,
    merchantName,
    expenseType: "single_amount",
    totalCents,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
  };
}

export function dmExpensePayload(
  me: Me,
  otherId: string,
  shares: [number, number],
  payerIndex: 0 | 1,
  totalCents: number,
): ExpensePayload {
  return {
    items: [],
    participants: [
      { kind: "user", userId: me.id },
      { kind: "user", userId: otherId },
    ],
    shares: [shares[0], shares[1]],
    payers: [{ participantIndex: payerIndex, amountCents: totalCents }],
    itemAssignments: null,
  };
}

export function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").toLowerCase();
}

export function wizardUrl(groupId: string, result: ChatExpenseResult): string {
  const params = new URLSearchParams({
    groupId,
    title: result.title,
    amount: String(result.amountCents),
  });
  return `/app/bill/new?${params.toString()}`;
}

export type DraftExpenseResolution =
  | { kind: "ready"; header: ExpenseHeader; payload: ExpensePayload }
  | { kind: "wizard"; url: string }
  | { kind: "error"; message: string };

export function resolveDraftExpense(
  groupId: string,
  me: Me,
  counterparty: UserProfile,
  result: ChatExpenseResult,
): DraftExpenseResolution {
  if (result.expenseType === "itemized") {
    return { kind: "wizard", url: wizardUrl(groupId, result) };
  }

  const totalCents = result.amountCents;
  let shares: [number, number];

  if (result.splitType === "custom" && result.allocations.length === 2) {
    const myHandle = normalizeHandle(me.handle);
    const theirHandle = normalizeHandle(counterparty.handle);
    let myShare: number | null = null;
    let otherShare: number | null = null;

    for (const alloc of result.allocations) {
      const handle = normalizeHandle(alloc.participantHandle);
      if (handle === myHandle && myShare === null) myShare = alloc.shareAmountCents;
      if (handle === theirHandle && otherShare === null) {
        otherShare = alloc.shareAmountCents;
      }
    }

    if (myShare === null || otherShare === null) {
      return { kind: "wizard", url: wizardUrl(groupId, result) };
    }
    shares = [myShare, otherShare];
  } else if (result.splitType === "equal") {
    const amounts = allocateEvenly(totalCents, 2);
    if (!amounts.ok) return { kind: "error", message: "Não foi possível dividir o valor." };
    shares = [amounts.value[0], amounts.value[1]];
  } else {
    return { kind: "wizard", url: wizardUrl(groupId, result) };
  }

  const payerHandle = result.payerHandle ? normalizeHandle(result.payerHandle) : null;
  const payerIndex: 0 | 1 =
    payerHandle === null || payerHandle === "self" || payerHandle === normalizeHandle(me.handle)
      ? 0
      : 1;

  const header = dmExpenseHeader(result.title || "Conta", totalCents, result.merchantName);
  const payload = dmExpensePayload(me, counterparty.id, shares, payerIndex, totalCents);

  return { kind: "ready", header, payload };
}
