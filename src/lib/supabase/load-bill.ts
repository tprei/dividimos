import { createClient } from "@/lib/supabase/client";
import type { Bill, BillItem, BillPayer, BillSplit, ItemSplit, LedgerEntry, User } from "@/types";

interface LoadedBill {
  bill: Bill;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  ledger: LedgerEntry[];
}

export async function loadBillFromSupabase(billId: string): Promise<LoadedBill | null> {
  const supabase = createClient();

  const { data: billRow } = await supabase
    .from("bills")
    .select("*")
    .eq("id", billId)
    .single();

  if (!billRow) return null;

  const { data: participantRows } = await supabase
    .from("bill_participants")
    .select("user_id")
    .eq("bill_id", billId);

  const userIds = (participantRows ?? []).map((p) => p.user_id);
  if (!userIds.includes(billRow.creator_id)) {
    userIds.push(billRow.creator_id);
  }
  let participants: User[] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("id", userIds);

    participants = (profiles ?? []).map((p) => ({
      id: p.id,
      email: "",
      handle: p.handle ?? "",
      name: p.name,
      pixKeyType: "email" as const,
      pixKeyHint: "",
      avatarUrl: p.avatar_url ?? undefined,
      onboarded: true,
      createdAt: "",
    }));
  }

  const { data: payerRows } = await supabase
    .from("bill_payers")
    .select("*")
    .eq("bill_id", billId);

  const payers: BillPayer[] = (payerRows ?? []).map((p) => ({
    userId: p.user_id,
    amountCents: p.amount_cents,
  }));

  const bill: Bill = {
    id: billRow.id,
    creatorId: billRow.creator_id,
    billType: (billRow as Record<string, unknown>).bill_type as string === "single_amount" ? "single_amount" : "itemized",
    title: billRow.title,
    merchantName: billRow.merchant_name ?? undefined,
    status: billRow.status,
    serviceFeePercent: billRow.service_fee_percent,
    fixedFees: billRow.fixed_fees,
    totalAmount: billRow.total_amount,
    totalAmountInput: (billRow as Record<string, unknown>).total_amount_input as number ?? 0,
    payers,
    createdAt: billRow.created_at,
    updatedAt: billRow.updated_at,
  };

  let items: BillItem[] = [];
  let splits: ItemSplit[] = [];

  if (bill.billType === "itemized") {
    const { data: itemRows } = await supabase
      .from("bill_items")
      .select("*")
      .eq("bill_id", billId);

    items = (itemRows ?? []).map((i) => ({
      id: i.id,
      billId: i.bill_id,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      totalPriceCents: i.total_price_cents,
      createdAt: i.created_at,
    }));

    if (items.length > 0) {
      const itemIds = items.map((i) => i.id);
      const { data: splitRows } = await supabase
        .from("item_splits")
        .select("*")
        .in("item_id", itemIds);

      splits = (splitRows ?? []).map((s) => ({
        id: s.id,
        itemId: s.item_id,
        userId: s.user_id,
        splitType: s.split_type,
        value: Number(s.value),
        computedAmountCents: s.computed_amount_cents,
      }));
    }
  }

  let billSplits: BillSplit[] = [];
  if (bill.billType === "single_amount") {
    const { data: splitRows } = await supabase
      .from("bill_splits")
      .select("*")
      .eq("bill_id", billId);

    billSplits = (splitRows ?? []).map((s) => ({
      userId: s.user_id,
      splitType: s.split_type as "equal" | "percentage" | "fixed",
      value: Number(s.value),
      computedAmountCents: s.computed_amount_cents,
    }));
  }

  const { data: ledgerRows } = await supabase
    .from("ledger")
    .select("*")
    .eq("bill_id", billId);

  const ledger: LedgerEntry[] = (ledgerRows ?? []).map((e) => ({
    id: e.id,
    billId: e.bill_id,
    fromUserId: e.from_user_id,
    toUserId: e.to_user_id,
    amountCents: e.amount_cents,
    status: e.status,
    paidAt: e.paid_at ?? undefined,
    confirmedAt: e.confirmed_at ?? undefined,
    createdAt: e.created_at,
  }));

  return { bill, participants, items, splits, billSplits, ledger };
}
