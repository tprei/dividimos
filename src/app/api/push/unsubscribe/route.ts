import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushFingerprint, type PushChannel } from "@/lib/push/fingerprint";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: { endpoint?: string; token?: string; channel?: "web" | "fcm" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channel: PushChannel = body.channel === "fcm" ? "fcm" : "web";

  if (channel === "fcm") {
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: "Token FCM é obrigatório" }, { status: 400 });
    }

    const fingerprint = pushFingerprint("fcm", token);

    const { data, error } = await supabase.rpc("release_push_subscription", {
      p_channel: "fcm",
      p_fingerprint: fingerprint,
    });

    if (error) {
      return NextResponse.json(
        { error: "Erro ao remover subscription" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, deleted: data ?? 0 });
  }

  // Web Push flow
  const { endpoint } = body;
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint é obrigatório" }, { status: 400 });
  }

  const fingerprint = pushFingerprint("web", endpoint);

  const { data, error } = await supabase.rpc("release_push_subscription", {
    p_channel: "web",
    p_fingerprint: fingerprint,
  });

  if (error) {
    return NextResponse.json(
      { error: "Erro ao remover subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, deleted: data ?? 0 });
}
