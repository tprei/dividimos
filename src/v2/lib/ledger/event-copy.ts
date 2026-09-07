import { formatBRL } from "@/lib/currency";
import type { ChangeSummary, GroupEvent } from "@/types/ledger";

export interface EventCopyContext {
  actorName: string;
  nameOf: (userId: string) => string;
  expenseTitle: string | null;
  viewerId: string;
}

function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}


function resolveName(
  nameOf: (userId: string) => string,
  userId: string | null | undefined,
): string {
  if (!userId) return "alguém";
  const name = nameOf(userId);
  return name && name.trim().length > 0 ? name : "alguém";
}

function resolveExpenseTitle(
  ctxTitle: string | null | undefined,
  eventTitle: string | null | undefined,
  payloadTitle: unknown,
  fallback = "a conta",
): string {
  if (ctxTitle && ctxTitle.trim().length > 0) return ctxTitle;
  if (eventTitle && eventTitle.trim().length > 0) return eventTitle;
  if (typeof payloadTitle === "string" && payloadTitle.trim().length > 0) {
    return payloadTitle;
  }
  return fallback;
}

function describeExpenseEdited(
  event: GroupEvent,
  actor: string,
  ctx: EventCopyContext,
): string {
  const title = resolveExpenseTitle(
    ctx.expenseTitle,
    event.expenseTitle,
    event.payload?.title,
    "a conta",
  );

  const rawSummary =
    (event.payload?.changeSummary as ChangeSummary | undefined) ??
    (event.payload as unknown as ChangeSummary | undefined);

  const sentences: string[] = [];

  if (
    rawSummary?.title &&
    Array.isArray(rawSummary.title) &&
    rawSummary.title.length === 2
  ) {
    sentences.push(
      `${actor} mudou o nome de “${rawSummary.title[0]}” para “${rawSummary.title[1]}”`,
    );
  }

  if (
    rawSummary?.totalCents &&
    Array.isArray(rawSummary.totalCents) &&
    rawSummary.totalCents.length === 2
  ) {
    sentences.push(
      `${actor} mudou o total de ${formatBRL(rawSummary.totalCents[0])} para ${formatBRL(rawSummary.totalCents[1])}`,
    );
  }

  if (
    rawSummary?.participantsAdded &&
    Array.isArray(rawSummary.participantsAdded) &&
    rawSummary.participantsAdded.length > 0
  ) {
    const names = formatNames(
      rawSummary.participantsAdded.map((id) => resolveName(ctx.nameOf, id)),
    );
    sentences.push(`${actor} adicionou ${names}`);
  }

  if (
    rawSummary?.participantsRemoved &&
    Array.isArray(rawSummary.participantsRemoved) &&
    rawSummary.participantsRemoved.length > 0
  ) {
    const names = formatNames(
      rawSummary.participantsRemoved.map((id) => resolveName(ctx.nameOf, id)),
    );
    sentences.push(`${actor} removeu ${names}`);
  }

  if (rawSummary?.payersChanged) {
    sentences.push(`${actor} mudou quem pagou`);
  }

  if (sentences.length === 0) {
    return `${actor} editou ${title}`;
  }

  return sentences.join(", ");
}

export function describeEvent(event: GroupEvent, ctx: EventCopyContext): string {
  const actor = ctx.actorName?.trim() || "Alguém";

  switch (event.kind) {
    case "expense_created": {
      const title = resolveExpenseTitle(
        ctx.expenseTitle,
        event.expenseTitle,
        event.payload?.title,
        "uma conta",
      );
      const totalCents =
        typeof event.payload?.totalCents === "number"
          ? event.payload.totalCents
          : null;
      return totalCents !== null
        ? `${actor} adicionou ${title} (${formatBRL(totalCents)})`
        : `${actor} adicionou ${title}`;
    }

    case "expense_edited":
      return describeExpenseEdited(event, actor, ctx);

    case "expense_deleted": {
      const title = resolveExpenseTitle(
        ctx.expenseTitle,
        event.expenseTitle,
        event.payload?.title,
        "a conta",
      );
      return `${actor} excluiu ${title}`;
    }

    case "expense_restored": {
      const title = resolveExpenseTitle(
        ctx.expenseTitle,
        event.expenseTitle,
        event.payload?.title,
        "a conta",
      );
      return `${actor} restaurou ${title}`;
    }

    case "settlement_recorded": {
      const amountCents =
        typeof event.payload?.amountCents === "number"
          ? event.payload.amountCents
          : 0;
      const amount = formatBRL(amountCents);
      const toUserId =
        (typeof event.payload?.toUserId === "string"
          ? event.payload.toUserId
          : null) ??
        event.subjectUserId ??
        "";

      if (toUserId && toUserId === ctx.viewerId) {
        return `${actor} marcou um pagamento de ${amount} pra você`;
      }
      return `${actor} marcou um pagamento de ${amount} para ${resolveName(ctx.nameOf, toUserId)}`;
    }

    case "settlement_confirmed": {
      const amountCents =
        typeof event.payload?.amountCents === "number"
          ? event.payload.amountCents
          : 0;
      const amount = formatBRL(amountCents);
      const fromUserId =
        (typeof event.payload?.fromUserId === "string"
          ? event.payload.fromUserId
          : null) ??
        event.subjectUserId ??
        "";
      return `${actor} confirmou o pagamento de ${amount} de ${resolveName(ctx.nameOf, fromUserId)}`;
    }

    case "settlement_voided": {
      const wasConfirmed = Boolean(event.payload?.wasConfirmed);
      const amountCents =
        typeof event.payload?.amountCents === "number"
          ? event.payload.amountCents
          : 0;
      const amount = formatBRL(amountCents);
      return wasConfirmed
        ? `${actor} desfez um pagamento de ${amount}`
        : `${actor} cancelou um pagamento de ${amount}`;
    }

    case "member_invited": {
      const userIds = Array.isArray(event.payload?.userIds)
        ? (event.payload.userIds as string[])
        : event.subjectUserId
          ? [event.subjectUserId]
          : [];
      const names =
        userIds.length > 0
          ? formatNames(userIds.map((id) => resolveName(ctx.nameOf, id)))
          : "alguém";
      return `${actor} convidou ${names}`;
    }

    case "member_joined": {
      const subject = resolveName(ctx.nameOf, event.subjectUserId);
      return `${subject} entrou no grupo`;
    }

    case "member_left": {
      const subject = resolveName(ctx.nameOf, event.subjectUserId);
      return `${subject} saiu do grupo`;
    }

    case "member_removed": {
      const subject = resolveName(ctx.nameOf, event.subjectUserId);
      return `${actor} removeu ${subject}`;
    }

    case "guest_claimed": {
      const subject = resolveName(ctx.nameOf, event.subjectUserId);
      const displayName =
        typeof event.payload?.displayName === "string" &&
        event.payload.displayName.trim().length > 0
          ? event.payload.displayName
          : "convidado";
      return `${subject} entrou como ${displayName}`;
    }

    case "nudge": {
      const subject = resolveName(ctx.nameOf, event.subjectUserId);
      return `${actor} lembrou ${subject} de acertar as contas`;
    }

    default:
      return `${actor} realizou uma ação`;
  }
}
