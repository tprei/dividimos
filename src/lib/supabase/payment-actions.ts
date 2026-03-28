import { createClient } from "@/lib/supabase/client";

/**
 * Record a payment from one user to another via the `create_payment` RPC.
 *
 * In the Splitwise model, a payment is a special bill where:
 *   - Payer (from) gets paid_cents = amount, owed_cents = 0  → net = +amount
 *   - Receiver (to) gets paid_cents = 0, owed_cents = amount → net = -amount
 *
 * This shifts the overall net balance in the right direction without
 * needing a separate payments/ledger table.
 */
export async function recordPayment(
  fromUserId: string,
  toUserId: string,
  amountCents: number,
  groupId?: string,
): Promise<{ billId?: string; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("create_payment", {
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_amount_cents: amountCents,
    p_group_id: groupId ?? null,
  });

  if (error) return { error: error.message };

  return { billId: data as string };
}
