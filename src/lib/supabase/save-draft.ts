import { createClient } from "@/lib/supabase/client";
import type { Bill, BillItem, BillSplit, ItemSplit, User } from "@/types";

interface SaveDraftParams {
  bill: Bill;
  participants: User[];
  creatorId: string;
  existingBillId?: string;
  groupId?: string;
  items?: BillItem[];
  splits?: ItemSplit[];
  billSplits?: BillSplit[];
}

export async function saveDraftToSupabase(
  params: SaveDraftParams,
): Promise<{ billId: string } | { error: string }> {
  const supabase = createClient();
  const { bill, participants, creatorId, existingBillId, groupId } = params;

  let billId = existingBillId;

  if (billId) {
    const updatePayload: Record<string, unknown> = {
      title: bill.title,
      merchant_name: bill.merchantName || null,
      service_fee_percent: bill.serviceFeePercent,
      fixed_fees: bill.fixedFees,
      total_amount: bill.totalAmount,
      bill_type: bill.billType,
      total_amount_input: bill.totalAmountInput,
    };
    if (groupId) updatePayload.group_id = groupId;

    const { error } = await supabase
      .from("bills")
      .update(updatePayload as Record<string, unknown>)
      .eq("id", billId);

    if (error) {
      console.error("Failed to update draft:", error);
      return { error: error.message };
    }
  } else {
    const insertPayload: Record<string, unknown> = {
      creator_id: creatorId,
      title: bill.title,
      merchant_name: bill.merchantName || null,
      status: "draft",
      service_fee_percent: bill.serviceFeePercent,
      fixed_fees: bill.fixedFees,
      total_amount: bill.totalAmount,
      bill_type: bill.billType,
      total_amount_input: bill.totalAmountInput,
    };
    if (groupId) insertPayload.group_id = groupId;

    const { data: inserted, error } = await supabase
      .from("bills")
      .insert(insertPayload as Record<string, unknown>)
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("Failed to insert draft:", error);
      return { error: error?.message ?? "Erro ao salvar rascunho" };
    }
    billId = inserted.id;
  }

  const { data: existingParticipants } = await supabase
    .from("bill_participants")
    .select("user_id")
    .eq("bill_id", billId);

  const existingIds = new Set((existingParticipants ?? []).map((p) => p.user_id));
  const newIds = new Set(participants.map((p) => p.id));

  const toRemove = [...existingIds].filter((id) => !newIds.has(id));
  if (toRemove.length > 0) {
    await supabase
      .from("bill_participants")
      .delete()
      .eq("bill_id", billId)
      .in("user_id", toRemove);
  }

  const toAdd = participants.filter((p) => !existingIds.has(p.id));
  if (toAdd.length > 0) {
    const rows = toAdd.map((p) => ({
      bill_id: billId!,
      user_id: p.id,
      // Group bills: all participants auto-accepted (no confirmation needed)
      status: (groupId || p.id === creatorId) ? "accepted" : "invited",
      invited_by: p.id === creatorId ? null : creatorId,
    }));
    const { error } = await supabase.from("bill_participants").insert(rows as unknown as Record<string, unknown>);
    if (error) console.error("Failed to insert participants:", error);
  }

  // Persist child data (items, splits, payers) so drafts are fully resumable
  await saveDraftChildData(supabase, billId!, params);

  return { billId: billId! };
}

async function saveDraftChildData(
  supabase: ReturnType<typeof createClient>,
  billId: string,
  params: SaveDraftParams,
) {
  const { bill, items, splits, billSplits } = params;

  // Persist payers — delete-and-reinsert for simplicity
  if (bill.payers.length > 0) {
    await supabase.from("bill_payers").delete().eq("bill_id", billId);
    const payerRows = bill.payers.map((p) => ({
      bill_id: billId,
      user_id: p.userId,
      amount_cents: p.amountCents,
    }));
    const { error } = await supabase.from("bill_payers").insert(payerRows);
    if (error) console.error("Failed to insert draft payers:", error);
  }

  // Persist itemized bill data
  if (bill.billType === "itemized" && items && items.length > 0) {
    // Remove old items (cascades to item_splits via FK)
    await supabase.from("bill_items").delete().eq("bill_id", billId);

    for (const item of items) {
      const { data: insertedItem, error: itemError } = await supabase
        .from("bill_items")
        .insert({
          bill_id: billId,
          description: item.description,
          quantity: item.quantity,
          unit_price_cents: item.unitPriceCents,
          total_price_cents: item.totalPriceCents,
        })
        .select("id")
        .single();

      if (itemError || !insertedItem) {
        console.error("Failed to insert draft item:", itemError);
        continue;
      }

      const itemSplitRows = (splits ?? [])
        .filter((s) => s.itemId === item.id)
        .map((s) => ({
          item_id: insertedItem.id,
          user_id: s.userId,
          split_type: s.splitType,
          value: s.value,
          computed_amount_cents: s.computedAmountCents,
        }));

      if (itemSplitRows.length > 0) {
        const { error } = await supabase.from("item_splits").insert(itemSplitRows);
        if (error) console.error("Failed to insert draft item splits:", error);
      }
    }
  }

  // Persist single_amount bill splits
  if (bill.billType === "single_amount" && billSplits && billSplits.length > 0) {
    await supabase.from("bill_splits").delete().eq("bill_id", billId);
    const splitRows = billSplits.map((s) => ({
      bill_id: billId,
      user_id: s.userId,
      split_type: s.splitType,
      value: s.value,
      computed_amount_cents: s.computedAmountCents,
    }));
    const { error } = await supabase.from("bill_splits").insert(splitRows);
    if (error) console.error("Failed to insert draft bill splits:", error);
  }
}
