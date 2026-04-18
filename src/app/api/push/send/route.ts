import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/push/notify-user";
import type { PushPayload } from "@/lib/push/web-push";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let reqBody: {
    userId: string;
    title: string;
    body: string;
    url?: string;
    tag?: string;
  };
  try {
    reqBody = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { userId, title, body: notifBody } = reqBody;
  if (!userId || !title || !notifBody) {
    return NextResponse.json(
      { error: "userId, title e body são obrigatórios" },
      { status: 400 },
    );
  }

  const { data: callerGroups } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("status", "accepted");

  const callerGroupIds = (callerGroups ?? []).map((g) => g.group_id);

  if (callerGroupIds.length === 0) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { count } = await supabase
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "accepted")
    .in("group_id", callerGroupIds);

  if (!count || count === 0) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  let safeUrl = reqBody.url;
  if (safeUrl) {
    if (safeUrl.startsWith("/") && !safeUrl.startsWith("//")) {
      // relative path — safe
    } else {
      try {
        const parsed = new URL(safeUrl);
        if (parsed.protocol !== "https:") {
          safeUrl = undefined;
        }
      } catch {
        safeUrl = undefined;
      }
    }
  }

  const payload: PushPayload = {
    title,
    body: notifBody,
    url: safeUrl,
    icon: "/icon-192.png",
    tag: reqBody.tag,
  };

  const result = await notifyUser(userId, payload);

  return NextResponse.json(result);
}
