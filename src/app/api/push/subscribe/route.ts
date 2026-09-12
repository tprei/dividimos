import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptPixKey as encrypt,
  decryptPixKey as decrypt,
  hashEndpoint,
} from "@/lib/crypto";
import { validateWebSubscription } from "@/lib/push/validate-endpoint";

type SubscribeBody = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const userId = claimsData.claims.sub;

  let body: SubscribeBody;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "Subscription inválida" }, { status: 400 });
    }
    body = parsed as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channel = body.channel === "fcm" ? "fcm" : "web";
  const admin = createAdminClient();

  if (channel === "fcm") {
    if (typeof body.token !== "string" || body.token.length === 0) {
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
        if (decrypted === body.token) duplicateIds.push(row.id);
      } catch {
        // Skip rows that can't be decrypted — stale data.
      }
    }

    if (duplicateIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", duplicateIds);
    }

    const encrypted = encrypt(body.token);
    const { error } = await admin.from("push_subscriptions").insert({
      user_id: userId,
      endpoint_digest: hashEndpoint(body.token),
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

  const validation = await validateWebSubscription(body.subscription);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error:
          validation.reason === "resolution_failed"
            ? "Não foi possível validar o endpoint agora"
            : "Subscription inválida",
      },
      { status: validation.reason === "resolution_failed" ? 503 : 400 },
    );
  }
  const subscription = validation.value;

  const { data: existing } = await admin
    .from("push_subscriptions")
    .select("id, subscription_encrypted")
    .eq("user_id", userId)
    .eq("channel", "web");

  const duplicateIds: string[] = [];
  for (const row of existing ?? []) {
    try {
      const stored = JSON.parse(decrypt(row.subscription_encrypted)) as {
        endpoint?: unknown;
      };
      if (stored.endpoint === subscription.endpoint) duplicateIds.push(row.id);
    } catch {
      // Skip rows that can't be decrypted — stale data.
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
