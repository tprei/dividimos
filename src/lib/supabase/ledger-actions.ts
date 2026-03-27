import { createClient } from "@/lib/supabase/client";
import { ledgerRowToLedgerEntry } from "@/lib/supabase/mappers";
import type { LedgerEntry } from "@/types";
import type { Database } from "@/types/database";

type LedgerRow = Database["public"]["Tables"]["ledger"]["Row"];

/**
 * Load all ledger entries for a group, including both debt and payment entries.
 */
export async function loadLedgerEntries(
  filter: { groupId: string } | { billId: string },
): Promise<LedgerEntry[]> {
  const supabase = createClient();

  let query = supabase.from("ledger").select("*");

  if ("groupId" in filter) {
    query = query.eq("group_id", filter.groupId);
  } else {
    query = query.eq("bill_id", filter.billId);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load ledger entries: ${error.message}`);
  }

  return (data as LedgerRow[] ?? []).map(ledgerRowToLedgerEntry);
}

/**
 * Add a debt entry to the ledger (created when a bill is finalized).
 */
export async function addDebtEntry(
  billId: string,
  groupId: string | null,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<{ id: string; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("ledger")
    .insert({
      bill_id: billId,
      entry_type: "debt" as const,
      group_id: groupId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
      paid_amount_cents: 0,
      status: "pending" as const,
    })
    .select("id")
    .single();

  if (error) {
    return { id: "", error: error.message };
  }

  return { id: data.id };
}

/**
 * Record a payment in the ledger as an append-only payment entry.
 * This does NOT mutate existing debt entries — it creates a new payment event.
 */
export async function recordPayment(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<{ id: string; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("ledger")
    .insert({
      entry_type: "payment" as const,
      group_id: groupId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
      paid_amount_cents: 0,
      status: "paid_unconfirmed" as const,
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return { id: "", error: error.message };
  }

  return { id: data.id };
}

/**
 * Confirm a payment entry. Only the creditor (to_user) should call this.
 * Sets confirmed_at timestamp and status to settled.
 */
export async function confirmPayment(
  entryId: string,
  confirmedByUserId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { error } = await supabase
    .from("ledger")
    .update({
      status: "settled" as const,
      confirmed_at: new Date().toISOString(),
      confirmed_by: confirmedByUserId,
    })
    .eq("id", entryId)
    .eq("entry_type", "payment");

  if (error) {
    return { error: error.message };
  }

  return {};
}

/**
 * Confirm all unconfirmed payment entries for a (group, from, to) pair.
 * Used by the group settlement view where individual payment entry IDs
 * are not tracked — instead we confirm all pending payments for the pair.
 */
export async function confirmPaymentsForPair(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  confirmedByUserId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { data: entries } = await supabase
    .from("ledger")
    .select("id")
    .eq("group_id", groupId)
    .eq("entry_type", "payment" as const)
    .eq("from_user_id", fromUserId)
    .eq("to_user_id", toUserId)
    .eq("status", "paid_unconfirmed" as const);

  if (!entries?.length) return {};

  const { error } = await supabase
    .from("ledger")
    .update({
      status: "settled" as const,
      confirmed_at: new Date().toISOString(),
      confirmed_by: confirmedByUserId,
    })
    .in(
      "id",
      entries.map((e) => e.id),
    );

  return { error: error?.message };
}

/**
 * Record a bill-level payment as a ledger entry.
 *
 * Creates a payment entry with `bill_id` set (so it appears in bill queries
 * and realtime subscriptions) and updates the debt entry's `paid_amount_cents`
 * so that `computeBillDebtView` derives the correct status.
 */
export async function recordBillPayment(
  billId: string,
  debtEntryId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<{ id: string; error?: string }> {
  const supabase = createClient();

  // 1. Create append-only payment entry in the ledger
  const { data, error: insertError } = await supabase
    .from("ledger")
    .insert({
      bill_id: billId,
      entry_type: "payment" as const,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
      paid_amount_cents: 0,
      status: "paid_unconfirmed" as const,
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError) {
    return { id: "", error: insertError.message };
  }

  // 2. Update the debt entry's paid_amount_cents for computeBillDebtView
  const { data: debtRow } = await supabase
    .from("ledger")
    .select("paid_amount_cents, amount_cents")
    .eq("id", debtEntryId)
    .single();

  if (debtRow) {
    const newPaid = Math.min(
      (debtRow.paid_amount_cents ?? 0) + amountCents,
      debtRow.amount_cents,
    );
    const newStatus = newPaid >= debtRow.amount_cents ? "paid_unconfirmed" : "partially_paid";
    await supabase
      .from("ledger")
      .update({ paid_amount_cents: newPaid, status: newStatus, paid_at: new Date().toISOString() })
      .eq("id", debtEntryId);
  }

  return { id: data.id };
}

/**
 * Confirm a bill-level payment. Sets confirmed_at on the debt entry
 * so that `computeBillDebtView` derives status as "settled".
 * Also marks any related payment entries as settled.
 */
export async function confirmBillPayment(
  debtEntryId: string,
  confirmedByUserId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const now = new Date().toISOString();

  // Update the debt entry with confirmation
  const { error } = await supabase
    .from("ledger")
    .update({
      status: "settled" as const,
      confirmed_at: now,
      confirmed_by: confirmedByUserId,
    })
    .eq("id", debtEntryId);

  if (error) {
    return { error: error.message };
  }

  // Also mark related payment entries as settled
  const { data: debtRow } = await supabase
    .from("ledger")
    .select("bill_id, from_user_id, to_user_id")
    .eq("id", debtEntryId)
    .single();

  if (debtRow?.bill_id) {
    await supabase
      .from("ledger")
      .update({
        status: "settled" as const,
        confirmed_at: now,
        confirmed_by: confirmedByUserId,
      })
      .eq("bill_id", debtRow.bill_id)
      .eq("entry_type", "payment" as const)
      .eq("from_user_id", debtRow.from_user_id)
      .eq("to_user_id", debtRow.to_user_id)
      .eq("status", "paid_unconfirmed" as const);
  }

  return {};
}
