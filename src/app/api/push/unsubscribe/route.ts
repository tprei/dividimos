import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey as decrypt } from "@/lib/crypto";

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

  const channel = body.channel === "fcm" ? "fcm" : "web";

  const admin = createAdminClient();

  if (channel === "fcm") {
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: "Token FCM é obrigatório" }, { status: 400 });
    }

    const { data: rows, error: fetchError } = await admin
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", user.id)
      .eq("channel", "fcm");

    if (fetchError || !rows) {
      return NextResponse.json({ error: "Erro ao buscar subscriptions" }, { status: 500 });
    }

    const idsToDelete: string[] = [];
    for (const row of rows) {
      try {
        const decrypted = decrypt(row.subscription);
        if (decrypted === token) {
          idsToDelete.push(row.id);
        }
      } catch {
        // Skip rows that can't be decrypted — they're stale anyway
      }
    }

    if (idsToDelete.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", idsToDelete);
    }

    return NextResponse.json({ ok: true, deleted: idsToDelete.length });
  }

  // Web Push flow (existing behavior)
  const { endpoint } = body;
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint é obrigatório" }, { status: 400 });
  }

  const { data: rows, error: fetchError } = await admin
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", user.id)
    .eq("channel", "web");

  if (fetchError || !rows) {
    return NextResponse.json({ error: "Erro ao buscar subscriptions" }, { status: 500 });
  }

  const idsToDelete: string[] = [];
  for (const row of rows) {
    try {
      const sub = JSON.parse(decrypt(row.subscription)) as { endpoint: string };
      if (sub.endpoint === endpoint) {
        idsToDelete.push(row.id);
      }
    } catch {
      // Skip rows that can't be decrypted — they're stale anyway
    }
  }

  if (idsToDelete.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", idsToDelete);
  }

  return NextResponse.json({ ok: true, deleted: idsToDelete.length });
}
