import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/push/notify-user";
import {
  categoryFor,
  eventNotification,
  recipientsFor,
  type EventNotificationMember,
} from "@/lib/push/event-notification";
import type { NotificationCategory, NotificationPreferences } from "@/types";
import type { Json } from "@/types/database";

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "expenses",
  "settlements",
  "nudges",
  "groups",
  "messages",
];

function readPreferences(json: Json | null): NotificationPreferences {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {};
  }
  const prefs: NotificationPreferences = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = json[category];
    if (typeof value === "boolean") {
      prefs[category] = value;
    }
  }
  return prefs;
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const callerId = claims.claims.sub;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const eventId =
    typeof body === "object" && body !== null && "eventId" in body
      ? body.eventId
      : null;
  if (typeof eventId !== "number" || !Number.isInteger(eventId)) {
    return NextResponse.json({ error: "eventId inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("group_events")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("notified_at", null)
    .eq("actor_id", callerId)
    .select()
    .single();

  if (!event) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const { data: group } = await admin
      .from("groups")
      .select("id, kind, name")
      .eq("id", event.group_id)
      .single();
    if (!group) {
      throw new Error(`group ${event.group_id} missing`);
    }

    const { data: memberRows } = await admin
      .from("group_members")
      .select("user_id, status, users!group_members_user_id_fkey ( name, notification_preferences )")

    const members: EventNotificationMember[] = (memberRows ?? []).map((row) => ({
      userId: row.user_id,
      name: row.users?.name ?? "",
      status: row.status,
      notificationPreferences: readPreferences(
        row.users?.notification_preferences ?? null,
      ),
    }));

    const nameById = new Map(members.map((member) => [member.userId, member.name]));
    const nameOf = (id: string | null): string =>
      id ? (nameById.get(id) ?? "") : "";

    let expenseTitle: string | null = null;
    if (event.expense_id) {
      const { data: expense } = await admin
        .from("expenses")
        .select("current_version_no")
        .eq("id", event.expense_id)
        .maybeSingle();
      if (expense) {
        const { data: version } = await admin
          .from("expense_versions")
          .select("title")
          .eq("expense_id", event.expense_id)
          .eq("version_no", expense.current_version_no)
          .maybeSingle();
        expenseTitle = version?.title ?? null;
      }
    }

    const category = categoryFor(event.kind);
    const recipientIds = new Set(recipientsFor(event, members));
    const targets = members.filter(
      (member) =>
        recipientIds.has(member.userId) &&
        member.notificationPreferences[category] !== false,
    );

    const shares = new Map<string, number>();
    if (event.kind === "expense_created" && event.expense_id && targets.length > 0) {
      const { data: participantRows } = await admin
        .from("expense_participants")
        .select("user_id, share_cents")
        .eq("expense_id", event.expense_id)
        .in(
          "user_id",
          targets.map((member) => member.userId),
        );
      for (const row of participantRows ?? []) {
        if (row.user_id !== null) {
          shares.set(row.user_id, row.share_cents);
        }
      }
    }

    const results = await Promise.all(
      targets.map((member) => {
        const payload = eventNotification(event, {
          groupName: group.name,
          isDm: group.kind === "dm",
          actorName: nameOf(event.actor_id),
          viewerId: member.userId,
          nameOf,
          expenseTitle,
          recipientShareCents: shares.get(member.userId) ?? null,
        });
        return notifyUser(member.userId, {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          tag: payload.tag,
        });
      }),
    );

    return NextResponse.json({
      sent: results.reduce((sent, result) => sent + result.sent, 0),
    });
  } catch (error) {
    console.error("notify route failed", error);
    return NextResponse.json({ sent: 0 });
  }
}
