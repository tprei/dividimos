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

  let body: {
    recipientUserId: string;
    senderName: string;
    messagePreview: string;
    conversationGroupId: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { recipientUserId, senderName, messagePreview, conversationGroupId } = body;
  if (!recipientUserId || !senderName || !messagePreview || !conversationGroupId) {
    return NextResponse.json(
      { error: "recipientUserId, senderName, messagePreview e conversationGroupId são obrigatórios" },
      { status: 400 },
    );
  }

  const { count } = await supabase
    .from("group_members")
    .select("*", { count: "exact", head: true })
    .eq("group_id", conversationGroupId)
    .eq("user_id", user.id)
    .eq("status", "accepted");

  if (!count || count === 0) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const payload: PushPayload = {
    title: senderName,
    body: messagePreview,
    url: `/app/conversations/${conversationGroupId}`,
    icon: "/icon-192.png",
    tag: `chat-${conversationGroupId}`,
  };

  const result = await notifyUser(recipientUserId, payload);

  return NextResponse.json(result);
}
