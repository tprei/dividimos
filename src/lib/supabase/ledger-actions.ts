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

  const { data: entry } = await supabase
    .from("ledger")
    .select("bill_id")
    .eq("id", entryId)
    .single();

  const { error } = await supabase
    .from("ledger")
    .update({ status: "settled", confirmed_at: new Date().toISOString() })
    .eq("id", entryId);

  if (!error && entry?.bill_id) {
    const { data: remaining } = await supabase
      .from("ledger")
      .select("id")
      .eq("bill_id", entry.bill_id)
      .neq("status", "settled");

    const onlyThisOne = remaining?.length === 1 && remaining[0].id === entryId;
    const noneLeft = !remaining || remaining.length === 0;

    if (noneLeft || onlyThisOne) {
      await supabase
        .from("bills")
        .update({ status: "settled" })
        .eq("id", entry.bill_id);
    } else {
      await supabase
        .from("bills")
        .update({ status: "partially_settled" })
        .eq("id", entry.bill_id);
    }
  }

  return { error: error?.message };
}
