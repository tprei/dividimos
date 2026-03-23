import { createClient } from "@/lib/supabase/client";

export async function markPaidInSupabase(entryId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("ledger")
    .update({ status: "paid_unconfirmed", paid_at: new Date().toISOString() })
    .eq("id", entryId);
  return { error: error?.message };
}

export async function confirmPaymentInSupabase(entryId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("ledger")
    .update({ status: "settled", confirmed_at: new Date().toISOString() })
    .eq("id", entryId);
  return { error: error?.message };
}
