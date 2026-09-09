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
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export interface ResolvedDraftActors {
  participantIds: [string, string];
  payerId: string;
}

export type DraftActorResolution =
  | { kind: "resolved"; actors: ResolvedDraftActors }
  | { kind: "error"; message: string };

function actorResolutionError(message: string): DraftActorResolution {
  return { kind: "error", message };
}

function resolveActorHandle(
  rawHandle: string,
  me: Me,
  counterparty: UserProfile,
): string | null | "equal_handles" {
  const normalized = normalizeHandle(rawHandle);
  const meHandle = normalizeHandle(me.handle);
  const counterpartyHandle = normalizeHandle(counterparty.handle);
  if (meHandle === counterpartyHandle) return "equal_handles";
  if (normalized === "self" || normalized === meHandle) return me.id;
  if (normalized === counterpartyHandle) return counterparty.id;
  return null;
}

function validateExplicitActors(
  handles: Array<string | null>,
  me: Me,
  counterparty: UserProfile,
): DraftActorResolution {
  const ids: string[] = [];
  for (const handle of handles) {
    if (handle === null) return actorResolutionError("Não consegui identificar todas as pessoas.");
    const id = resolveActorHandle(handle, me, counterparty);
    if (id === "equal_handles") {
      return actorResolutionError("Os handles da conversa precisam ser diferentes.");
    }
    if (id === null) return actorResolutionError("Não consegui identificar todas as pessoas.");
    if (ids.includes(id)) return actorResolutionError("A mesma pessoa apareceu mais de uma vez.");
    ids.push(id);
  }

  const isImplicitCurrentUserOnly = ids.length === 1 && ids[0] === counterparty.id;
  if (
    !isImplicitCurrentUserOnly &&
    (ids.length !== 2 || !ids.includes(me.id) || !ids.includes(counterparty.id))
  ) {
    return actorResolutionError("A despesa precisa ter exatamente as duas pessoas da conversa.");
  }
  return {
    kind: "resolved",
    actors: { participantIds: [me.id, counterparty.id], payerId: me.id },
  };
}

export function resolveDraftActors(
  result: ChatExpenseResult,
  me: Me,
  counterparty: UserProfile,
): DraftActorResolution {
  const meHandle = normalizeHandle(me.handle);
  const counterpartyHandle = normalizeHandle(counterparty.handle);
  if (meHandle === counterpartyHandle) {
    return actorResolutionError("Os handles da conversa precisam ser diferentes.");
  }

  let actors: ResolvedDraftActors = {
    participantIds: [me.id, counterparty.id],
    payerId: me.id,
  };

  if (result.participants.length > 0) {
    if (result.participants.some((participant) => participant.confidence === "low")) {
      return actorResolutionError("Não consegui identificar todas as pessoas.");
    }
    const participantResolution = validateExplicitActors(
      result.participants.map((participant) => participant.matchedHandle),
      me,
      counterparty,
    );
    if (participantResolution.kind === "error") return participantResolution;
    actors = participantResolution.actors;
  }

  if (result.splitType === "custom") {
    const allocationResolution = validateExplicitActors(
      result.allocations.map((allocation) => allocation.participantHandle),
      me,
      counterparty,
    );
    if (allocationResolution.kind === "error") return allocationResolution;
    actors = allocationResolution.actors;
  }

  if (result.payerHandle !== null && result.payerHandle.trim() !== "") {
    const payerId = resolveActorHandle(result.payerHandle, me, counterparty);
    if (payerId === "equal_handles") {
      return actorResolutionError("Os handles da conversa precisam ser diferentes.");
    }
    if (payerId === null) return actorResolutionError("Não consegui identificar quem pagou.");
    actors.payerId = payerId;
  }

  return { kind: "resolved", actors };
}

export function wizardUrl(
  groupId: string,
  result: ChatExpenseResult,
  actors?: ResolvedDraftActors,
): string {
  const params = new URLSearchParams({
    groupId,
    title: result.title,
    amount: String(result.amountCents),
    type: result.expenseType,
  });
  if (actors) {
    params.set("participantIds", actors.participantIds.join(","));
    params.set("payerId", actors.payerId);
  }
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
  const actorResolution = resolveDraftActors(result, me, counterparty);
  if (actorResolution.kind === "error") return actorResolution;
  const actors = actorResolution.actors;

  if (result.expenseType === "itemized") {
    return { kind: "wizard", url: wizardUrl(groupId, result, actors) };
  }

  const totalCents = result.amountCents;
  let shares: [number, number];

  if (result.splitType === "custom") {
    let myShare: number | null = null;
    let otherShare: number | null = null;
    for (const allocation of result.allocations) {
      const actorId = resolveActorHandle(allocation.participantHandle, me, counterparty);
      if (actorId === me.id) myShare = allocation.shareAmountCents;
      if (actorId === counterparty.id) otherShare = allocation.shareAmountCents;
    }
    if (myShare === null || otherShare === null) {
      return { kind: "error", message: "Não consegui resolver as partes da despesa." };
    }
    shares = [myShare, otherShare];
  } else if (result.splitType === "equal") {
    const amounts = allocateEvenly(totalCents, 2);
    if (!amounts.ok) return { kind: "error", message: "Não foi possível dividir o valor." };
    shares = [amounts.value[0], amounts.value[1]];
  } else {
    return { kind: "error", message: "Não consegui resolver a divisão da despesa." };
  }

  const header = dmExpenseHeader(result.title || "Conta", totalCents, result.merchantName);
  const payload = dmExpensePayload(
    me,
    counterparty.id,
    shares,
    actors.payerId === me.id ? 0 : 1,
    totalCents,
  );

  return { kind: "ready", header, payload };
}
