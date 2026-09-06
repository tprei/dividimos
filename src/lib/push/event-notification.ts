import { formatBRL } from "@/lib/currency";
import { describeEvent } from "@/lib/ledger/event-copy";
import type { NotificationCategory, NotificationPreferences } from "@/types";
import type { Database } from "@/types/database";

export type GroupEventRow = Database["public"]["Tables"]["group_events"]["Row"];

export interface EventNotificationMember {
  userId: string;
  name: string;
  status: "invited" | "accepted";
  notificationPreferences: NotificationPreferences;
}

export interface EventNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  category: NotificationCategory;
}

export interface EventNotificationContext {
  groupName: string;
  isDm: boolean;
  actorName: string;
  viewerId: string;
  nameOf: (userId: string) => string;
  expenseTitle: string | null;
  recipientShareCents: number | null;
}

function payloadRecord(event: GroupEventRow): Record<string, unknown> {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {};
  }
  return payload;
}

export function categoryFor(kind: GroupEventRow["kind"]): NotificationCategory {
  if (kind.startsWith("expense")) return "expenses";
  if (kind.startsWith("settlement")) return "settlements";
  if (kind === "nudge") return "nudges";
  return "groups";
}

export function recipientsFor(
  event: GroupEventRow,
  members: EventNotificationMember[],
): string[] {
  const kind = event.kind;
  const byId = new Map(members.map((member) => [member.userId, member]));

  if (kind.startsWith("settlement") || kind === "nudge") {
    const subject = event.subject_user_id;
    return subject && byId.has(subject) ? [subject] : [];
  }

  if (kind === "member_invited") {
    const raw = payloadRecord(event).userIds;
    const invited = new Set(
      Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : [],
    );
    return members
      .filter((member) => invited.has(member.userId))
      .map((member) => member.userId);
  }

  const excluded = new Set<string>();
  if (event.actor_id) excluded.add(event.actor_id);
  if (
    kind === "member_joined" ||
    kind === "member_left" ||
    kind === "member_removed" ||
    kind === "guest_claimed"
  ) {
    if (event.subject_user_id) excluded.add(event.subject_user_id);
  }

  return members
    .filter(
      (member) => member.status === "accepted" && !excluded.has(member.userId),
    )
    .map((member) => member.userId);
}

function eventUrl(event: GroupEventRow, isDm: boolean): string {
  const kind = event.kind;
  if (kind.startsWith("expense") && event.expense_id) {
    return `/app/bill/${event.expense_id}`;
  }
  if (kind.startsWith("settlement") || kind === "nudge") {
    return "/app";
  }
  if (isDm && event.actor_id) {
    return `/app/conversations/${event.actor_id}`;
  }
  return `/app/groups/${event.group_id}`;
}

export function eventNotification(
  event: GroupEventRow,
  ctx: EventNotificationContext,
): EventNotificationPayload {
  const body = describeEvent(
    {
      id: event.id,
      groupId: event.group_id,
      actorId: event.actor_id,
      kind: event.kind,
      expenseId: event.expense_id,
      settlementId: event.settlement_id,
      subjectUserId: event.subject_user_id,
      payload: payloadRecord(event),
      createdAt: event.created_at,
      actor: null,
      expenseTitle: null,
    },
    {
      actorName: ctx.actorName,
      nameOf: ctx.nameOf,
      expenseTitle: ctx.expenseTitle,
      viewerId: ctx.viewerId,
    },
  );

  const shareSuffix =
    event.kind === "expense_created" && ctx.recipientShareCents !== null
      ? ` · sua parte: ${formatBRL(ctx.recipientShareCents)}`
      : "";

  return {
    title: ctx.isDm ? ctx.actorName : ctx.groupName,
    body: `${body}${shareSuffix}`,
    url: eventUrl(event, ctx.isDm),
    tag: `event-${event.id}`,
    category: categoryFor(event.kind),
  };
}
