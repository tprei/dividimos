import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptPixKey as encrypt,
  decryptPixKey as decrypt,
} from "@/lib/crypto";

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

  const channel = ("channel" in body && body.channel === "fcm") ? "fcm" : "web";

  const admin = createAdminClient();

  const MAX_SUBSCRIPTIONS_PER_USER = 20;
  const { count: subCount } = await admin
    .from("push_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (subCount !== null && subCount >= MAX_SUBSCRIPTIONS_PER_USER) {
    return NextResponse.json(
      { error: "Limite de dispositivos atingido" },
      { status: 429 },
    );
  }

  if (channel === "fcm") {
    const fcmBody = body as { token: string; channel: "fcm" };
    if (!fcmBody.token || typeof fcmBody.token !== "string") {
      return NextResponse.json(
        { error: "Token FCM obrigatório" },
        { status: 400 },
      );
    }

    const { data: existing } = await admin
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", user.id)
      .eq("channel", "fcm");

    const duplicateIds: string[] = [];
    for (const row of existing ?? []) {
      try {
        const decrypted = decrypt(row.subscription);
        if (decrypted === fcmBody.token) {
          duplicateIds.push(row.id);
        }
      } catch {
        // Skip rows that can't be decrypted — stale data
      }
    }

    if (duplicateIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", duplicateIds);
    }

    const encrypted = encrypt(fcmBody.token);

    const { error } = await admin.from("push_subscriptions").insert({
      user_id: user.id,
      subscription: encrypted,
      channel: "fcm",
    });

    if (error) {
      return NextResponse.json(
        { error: "Erro ao salvar subscription" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  }

  // Web Push flow (existing behavior)
  const webBody = body as { subscription: PushSubscriptionJSON };
  const { subscription } = webBody;
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json(
      { error: "Subscription inválida — endpoint e keys são obrigatórios" },
      { status: 400 },
    );
  }

  const { data: existing } = await admin
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", user.id)
    .eq("channel", "web");

  const duplicateIds: string[] = [];
  for (const row of existing ?? []) {
    try {
      const sub = JSON.parse(decrypt(row.subscription)) as {
        endpoint: string;
      };
      if (sub.endpoint === subscription.endpoint) {
        duplicateIds.push(row.id);
      }
    } catch {
      // Skip rows that can't be decrypted — stale data
    }
  }

  if (duplicateIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", duplicateIds);
  }

  const encrypted = encrypt(JSON.stringify(subscription));

  const { error } = await admin.from("push_subscriptions").insert({
    user_id: user.id,
    subscription: encrypted,
    channel: "web",
  });

  if (error) {
    return NextResponse.json(
      { error: "Erro ao salvar subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
