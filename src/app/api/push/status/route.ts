import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashEndpoint } from "@/lib/crypto";

/**
 * Does the signed-in account currently own this endpoint?
 *
 * The UI cannot answer this from browser state: a subscription can exist
 * locally while the server row belongs to another account or is gone, and
 * both cases must read as not subscribed for the caller.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const userId = claimsData.claims.sub;

  let body: { endpoint?: unknown; token?: unknown; channel?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channel = body.channel === "fcm" ? "fcm" : "web";
  const identity = channel === "fcm" ? body.token : body.endpoint;
  if (typeof identity !== "string" || identity.length === 0) {
    return NextResponse.json({ error: "Endpoint obrigatório" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("user_id")
    .eq("endpoint_digest", hashEndpoint(identity))
    .maybeSingle();

  if (error) {
    console.error("[push/status] lookup failed:", error);
    return NextResponse.json({ error: "Erro ao consultar subscription" }, { status: 500 });
  }

  return NextResponse.json({ subscribed: data?.user_id === userId });
}
