import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashEndpoint } from "@/lib/crypto";

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

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const requestedChannel = body.channel;
  if (
    requestedChannel !== undefined &&
    requestedChannel !== "web" &&
    requestedChannel !== "fcm"
  ) {
    return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  }
  const channel = requestedChannel === "fcm" ? "fcm" : "web";
  const identity = channel === "fcm" ? body.token : body.endpoint;
  if (typeof identity !== "string" || identity.length === 0) {
    return NextResponse.json(
      { error: channel === "fcm" ? "Token FCM é obrigatório" : "Endpoint é obrigatório" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("endpoint_digest", hashEndpoint(identity))
    .select("id");

  if (error) {
    console.error("[push/unsubscribe] delete failed:", error);
    return NextResponse.json(
      { error: "Erro ao remover subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: Array.isArray(data) ? data.length : 0,
  });
}
