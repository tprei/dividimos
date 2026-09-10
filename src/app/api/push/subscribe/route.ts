import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPixKey as encrypt, hashEndpoint } from "@/lib/crypto";
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

    const { error } = await admin.rpc("claim_push_subscription", {
      p_user_id: userId,
      p_channel: "fcm",
      p_endpoint_digest: hashEndpoint(body.token),
      p_subscription_encrypted: encrypt(body.token),
    });

    if (error) {
      console.error("[push/subscribe] claim failed:", error);
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

  const { error } = await admin.rpc("claim_push_subscription", {
    p_user_id: userId,
    p_channel: "web",
    p_endpoint_digest: hashEndpoint(subscription.endpoint),
    p_subscription_encrypted: encrypt(JSON.stringify(subscription)),
  });

  if (error) {
    console.error("[push/subscribe] claim failed:", error);
    return NextResponse.json(
      { error: "Erro ao salvar subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
