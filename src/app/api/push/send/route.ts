import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/push/notify-user";
import type { PushPayload } from "@/lib/push/web-push";

/**
 * POST /api/push/send
 *
 * Send a push notification to a target user. Only authenticated users
 * can trigger this (the caller must be a member of the same group, etc).
 *
 * Body: { userId: string; title: string; body: string; url?: string; tag?: string }
 */
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

  const payload: PushPayload = {
    title,
    body: notifBody,
    url: reqBody.url,
    icon: "/icon-192.png",
    tag: reqBody.tag,
  };

  const result = await notifyUser(userId, payload);

  return NextResponse.json(result);
}
