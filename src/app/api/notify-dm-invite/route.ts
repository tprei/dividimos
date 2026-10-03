import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/push/notify-user";
import { readPreferences } from "@/lib/push/preferences";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

const MESSAGE_PREVIEW_MAX = 120;

function messagePreview(content: string): string {
  const chars = Array.from(content);
  if (chars.length <= MESSAGE_PREVIEW_MAX) return content;
  return `${chars.slice(0, MESSAGE_PREVIEW_MAX).join("")}…`;
}

const ZERO_OUTCOME = { sent: 0, cleaned: 0, failed: 0 };

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
  const record = typeof body === "object" && body !== null ? body : {};
  const groupId = "groupId" in record ? record.groupId : null;
  const messageId = "messageId" in record ? record.messageId : null;
  if (typeof groupId !== "string" || groupId === "" || typeof messageId !== "string" || messageId === "") {
    return NextResponse.json({ error: "groupId e messageId são obrigatórios" }, { status: 400 });
  }

  try {
    await enforceRateLimit("push.send", callerId);
  } catch (error) {
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

  const admin = createAdminClient();

  try {
    const [messageResult, groupResult, membersResult, blockersResult] = await Promise.all([
      admin
        .from("chat_messages")
        .select("id, group_id, sender_id, content, erased_at")
        .eq("id", messageId)
        .maybeSingle(),
      admin.from("groups").select("id, kind").eq("id", groupId).maybeSingle(),
      admin
        .from("group_members")
        .select(
          "user_id, status, archived_at, users!group_members_user_id_fkey ( name, notification_preferences )",
        )
        .eq("group_id", groupId),
      admin.rpc("get_push_blockers", { p_actor_id: callerId }),
    ]);
    if (messageResult.error) throw messageResult.error;
    if (groupResult.error) throw groupResult.error;
    if (membersResult.error) throw membersResult.error;
    if (blockersResult.error) throw blockersResult.error;

    const message = messageResult.data;
    const group = groupResult.data;
    if (
      !message ||
      !group ||
      message.sender_id !== callerId ||
      message.group_id !== groupId ||
      message.erased_at !== null ||
      group.kind !== "dm"
    ) {
      return new NextResponse(null, { status: 204 });
    }

    const pushBlockers = new Set(blockersResult.data);
    const members = membersResult.data ?? [];
    const senderName = members.find((row) => row.user_id === callerId)?.users?.name ?? "";
    const inviteeIds = members
      .filter(
        (row) =>
          row.user_id !== callerId &&
          row.status === "invited" &&
          row.archived_at === null &&
          !pushBlockers.has(row.user_id) &&
          readPreferences(row.users?.notification_preferences ?? null).messages !== false,
      )
      .map((row) => row.user_id);
    if (inviteeIds.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    const { data: claimedEvent } = await admin
      .from("group_events")
      .update({ notified_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("kind", "member_invited")
      .eq("actor_id", callerId)
      .is("notified_at", null)
      .select("id")
      .limit(1);
    if (!claimedEvent || claimedEvent.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    const preview = messagePreview(message.content ?? "");
    const url = `/app/conversations/${callerId}`;

    let skipped = 0;
    const results = await Promise.all(
      inviteeIds.map(async (userId) => {
        try {
          await enforceRateLimit("push.send-pair", `${callerId}:${userId}`);
        } catch {
          skipped++;
          return ZERO_OUTCOME;
        }
        return notifyUser(userId, {
          title: senderName,
          body: `quer conversar com você: ${preview}`,
          url,
          tag: `chat-${groupId}`,
        });
      }),
    );

    const outcome = results.reduce(
      (total, result) => ({
        sent: total.sent + result.sent,
        cleaned: total.cleaned + result.cleaned,
        failed: total.failed + result.failed,
      }),
      ZERO_OUTCOME,
    );

    return NextResponse.json({
      ...outcome,
      skipped,
      recipients: inviteeIds.length,
    });
  } catch (error) {
    console.error("notify-dm-invite route failed", error);
    return NextResponse.json(
      { ...ZERO_OUTCOME, skipped: 0, recipients: 0 },
      { status: 500 },
    );
  }
}
