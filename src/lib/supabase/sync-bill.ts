import { createClient } from "@/lib/supabase/client";
import type { Bill, BillItem, BillPayer, BillSplit, ItemSplit, LedgerEntry, User } from "@/types";

interface BillData {
  bill: Bill;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  ledger: LedgerEntry[];
  existingBillId?: string;
  groupId?: string;
}

export async function syncBillToSupabase(data: BillData): Promise<{ billId: string } | { error: string }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado" };

  let billId: string;

  if (data.existingBillId) {
    billId = data.existingBillId;

    // Group bills skip acceptance check — all participants are auto-accepted
    if (!data.groupId) {
      const { data: pending } = await supabase
        .from("bill_participants")
        .select("user_id, status")
        .eq("bill_id", billId)
        .neq("user_id", user.id)
        .neq("status", "accepted");

      if (pending && pending.length > 0) {
        return { error: "Nem todos os participantes aceitaram o convite" };
      }
    }

    const syncUpdatePayload: Record<string, unknown> = {
      status: data.bill.status === "settled" ? "settled" : "active",
      total_amount: data.bill.totalAmount,
      total_amount_input: data.bill.totalAmountInput,
      service_fee_percent: data.bill.serviceFeePercent,
      fixed_fees: data.bill.fixedFees,
    };
    if (data.groupId) syncUpdatePayload.group_id = data.groupId;

    const { error: updateError } = await supabase
      .from("bills")
      .update(syncUpdatePayload as any)
      .eq("id", billId);

    if (updateError) {
      console.error("Failed to update bill:", updateError);
      return { error: updateError.message };
    }
  } else {
    const { data: inserted, error: billError } = await supabase
      .from("bills")
      .insert({
        creator_id: user.id,
        title: data.bill.title,
        merchant_name: data.bill.merchantName || null,
        status: data.bill.status === "settled" ? "settled" : "active",
        service_fee_percent: data.bill.serviceFeePercent,
        fixed_fees: data.bill.fixedFees,
        total_amount: data.bill.totalAmount,
        bill_type: data.bill.billType,
        total_amount_input: data.bill.totalAmountInput,
      })
      .select("id")
      .single();

    if (billError || !inserted) {
      console.error("Failed to insert bill:", billError);
      return { error: billError?.message ?? "Erro ao salvar conta" };
    }
    billId = inserted.id;

    const participantRows = data.participants.map((p) => ({
      bill_id: billId,
      user_id: p.id,
      status: "accepted" as const,
    }));
    if (participantRows.length > 0) {
      const { error } = await supabase.from("bill_participants").insert(participantRows);
      if (error) console.error("Failed to insert participants:", error);
    }
  }

  if (data.bill.billType === "itemized" && data.items.length > 0) {
    for (const item of data.items) {
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
        console.error("Failed to insert item:", itemError);
        continue;
      }

      const itemSplits = data.splits
        .filter((s) => s.itemId === item.id)
        .map((s) => ({
          item_id: insertedItem.id,
          user_id: s.userId,
          split_type: s.splitType,
          value: s.value,
          computed_amount_cents: s.computedAmountCents,
        }));

      if (itemSplits.length > 0) {
        const { error } = await supabase.from("item_splits").insert(itemSplits);
        if (error) console.error("Failed to insert item splits:", error);
      }
    }
  }

  if (data.bill.billType === "single_amount" && data.billSplits.length > 0) {
    const splitRows = data.billSplits.map((s) => ({
      bill_id: billId,
      user_id: s.userId,
      split_type: s.splitType,
      value: s.value,
      computed_amount_cents: s.computedAmountCents,
    }));
    const { error } = await supabase.from("bill_splits").insert(splitRows);
    if (error) console.error("Failed to insert bill splits:", error);
  }

  if (data.bill.payers.length > 0) {
    const payerRows = data.bill.payers.map((p) => ({
      bill_id: billId,
      user_id: p.userId,
      amount_cents: p.amountCents,
    }));
    const { error } = await supabase.from("bill_payers").insert(payerRows);
    if (error) console.error("Failed to insert payers:", error);
  }

  if (data.ledger.length > 0) {
    const ledgerRows = data.ledger.map((e) => ({
      bill_id: billId,
      from_user_id: e.fromUserId,
      to_user_id: e.toUserId,
      amount_cents: e.amountCents,
      status: e.status,
    }));
    const { error } = await supabase.from("ledger").insert(ledgerRows);
    if (error) console.error("Failed to insert ledger:", error);
  }

  return { billId };
}
