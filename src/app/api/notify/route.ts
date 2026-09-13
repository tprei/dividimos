import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/push/notify-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
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

/** Lets a later attempt re-dispatch an event that never reached anyone. */
async function releaseClaim(
  admin: ReturnType<typeof createAdminClient>,
  eventId: number,
): Promise<void> {
  await admin
    .from("group_events")
    .update({ notified_at: null })
    .eq("id", eventId);
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

  // One dispatch, one token: an actor cannot fan out unboundedly by
  // generating events. Failing closed here means zero sends.
  try {
    await enforceRateLimit("push.send", callerId);
  } catch (error) {
    await releaseClaim(admin, eventId);
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Muitas notificações. Tente novamente em alguns segundos." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Não foi possível verificar o limite de notificações." },
      { status: 503 },
    );
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
      .eq("group_id", event.group_id);

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
    const memberById = new Map(members.map((member) => [member.userId, member]));
    const targets = [...new Set(recipientsFor(event, members))].flatMap(
      (userId) => {
        const member = memberById.get(userId);
        if (!member || member.notificationPreferences[category] === false) {
          return [];
        }
        return [member];
      },
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

    let skipped = 0;

    const results = await Promise.all(
      targets.map(async (member) => {
        // Per (actor, recipient): one exhausted pair skips that recipient
        // only, and never blocks a sibling or another actor.
        try {
          await enforceRateLimit("push.send-pair", `${callerId}:${member.userId}`);
        } catch {
          skipped++;
          return { sent: 0, cleaned: 0, failed: 0 };
        }

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

    const outcome = results.reduce(
      (total, result) => ({
        sent: total.sent + result.sent,
        cleaned: total.cleaned + result.cleaned,
        failed: total.failed + result.failed,
      }),
      { sent: 0, cleaned: 0, failed: 0 },
    );

    // Hold a claim only when there is a transport failure worth retrying.
    // Preference suppression, missing devices, and stale-device cleanup are
    // terminal outcomes for this event.
    if (outcome.sent === 0 && (outcome.failed > 0 || skipped > 0)) {
      await releaseClaim(admin, eventId);
    }

    return NextResponse.json({
      ...outcome,
      skipped,
      recipients: targets.length,
    });
  } catch (error) {
    console.error("notify route failed", error);
    await releaseClaim(admin, eventId);
    return NextResponse.json(
      { sent: 0, cleaned: 0, failed: 1, recipients: 0, skipped: 0 },
      { status: 500 },
    );
  }
}
