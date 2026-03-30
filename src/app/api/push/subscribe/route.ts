import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptPixKey as encrypt,
  decryptPixKey as decrypt,
} from "@/lib/crypto";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: { subscription: PushSubscriptionJSON };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { subscription } = body;
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json(
      { error: "Subscription inválida — endpoint e keys são obrigatórios" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", user.id);

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
  });

  if (error) {
    return NextResponse.json(
      { error: "Erro ao salvar subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
