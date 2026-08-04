import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptPixKey as encrypt } from "@/lib/crypto";
import { pushFingerprint, type PushChannel } from "@/lib/push/fingerprint";

type SubscribeBody =
  | { subscription: PushSubscriptionJSON; channel?: "web" }
  | { token: string; channel: "fcm" };

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channel: PushChannel =
    "channel" in body && body.channel === "fcm" ? "fcm" : "web";

  if (channel === "fcm") {
    const fcmBody = body as { token: string; channel: "fcm" };
    if (!fcmBody.token || typeof fcmBody.token !== "string") {
      return NextResponse.json(
        { error: "Token FCM obrigatório" },
        { status: 400 },
      );
    }

    const fingerprint = pushFingerprint("fcm", fcmBody.token);
    const encrypted = encrypt(fcmBody.token);

    const { error } = await supabase.rpc("claim_push_subscription", {
      p_channel: "fcm",
      p_fingerprint: fingerprint,
      p_subscription: encrypted,
    });

    if (error) {
      if (error.code === "PST09") {
        return NextResponse.json(
          { error: "Limite de dispositivos atingido" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Erro ao salvar subscription" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  }

  // Web Push flow
  const webBody = body as { subscription: PushSubscriptionJSON };
  const { subscription } = webBody;
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json(
      { error: "Subscription inválida — endpoint e keys são obrigatórios" },
      { status: 400 },
    );
  }

  const fingerprint = pushFingerprint("web", subscription.endpoint);
  const encrypted = encrypt(JSON.stringify(subscription));

  const { error } = await supabase.rpc("claim_push_subscription", {
    p_channel: "web",
    p_fingerprint: fingerprint,
    p_subscription: encrypted,
  });

  if (error) {
    if (error.code === "PST09") {
      return NextResponse.json(
        { error: "Limite de dispositivos atingido" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao salvar subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
