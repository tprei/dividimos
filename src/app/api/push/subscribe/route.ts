import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptPixKey as encrypt,
  decryptPixKey as decrypt,
  hashEndpoint,
} from "@/lib/crypto";

type SubscribeBody =
  | { subscription: PushSubscriptionJSON; channel?: "web" }
  | { token: string; channel: "fcm" };

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const userId = claimsData.claims.sub;

  let body: SubscribeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channel = ("channel" in body && body.channel === "fcm") ? "fcm" : "web";

  const admin = createAdminClient();

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
      .select("id, subscription_encrypted")
      .eq("user_id", userId)
      .eq("channel", "fcm");

    const duplicateIds: string[] = [];
    for (const row of existing ?? []) {
      try {
        const decrypted = decrypt(row.subscription_encrypted);
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
      user_id: userId,
      endpoint_digest: hashEndpoint(fcmBody.token),
      subscription_encrypted: encrypted,
      channel: "fcm",
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
    .select("id, subscription_encrypted")
    .eq("user_id", userId)
    .eq("channel", "web");

  const duplicateIds: string[] = [];
  for (const row of existing ?? []) {
    try {
      const sub = JSON.parse(decrypt(row.subscription_encrypted)) as {
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
    user_id: userId,
    endpoint_digest: hashEndpoint(subscription.endpoint),
    subscription_encrypted: encrypted,
    channel: "web",
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
