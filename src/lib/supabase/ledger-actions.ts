import { createClient } from "@/lib/supabase/client";

export async function recordPaymentInSupabase(
  entryId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
  newPaidAmountCents: number,
  newStatus: "partially_paid" | "paid_unconfirmed",
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
      ledger_id: entryId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    });

  if (paymentError) return { error: paymentError.message };

  const { error: ledgerError } = await supabase
    .from("ledger")
    .update({
      paid_amount_cents: newPaidAmountCents,
      status: newStatus,
      paid_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  return { error: ledgerError?.message };
}

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
