import { createClient } from "@/lib/supabase/client";
import type { Bill, User } from "@/types";

interface SaveDraftParams {
  bill: Bill;
  participants: User[];
  creatorId: string;
  existingBillId?: string;
  groupId?: string;
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
    const { error } = await supabase.from("bill_participants").insert(rows as Record<string, unknown>);
    if (error) console.error("Failed to insert participants:", error);
  }

  return { billId: billId! };
}
