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

  const billType =
    (billRow as Record<string, unknown>).bill_type as string === "single_amount"
      ? "single_amount"
      : "itemized";

  const [participantResult, payerResult, ledgerResult, itemOrSplitResult] = await Promise.all([
    supabase.from("bill_participants").select("user_id").eq("bill_id", billId),
    supabase.from("bill_payers").select("*").eq("bill_id", billId),
    supabase.from("ledger").select("*").eq("bill_id", billId),
    billType === "itemized"
      ? supabase.from("bill_items").select("*").eq("bill_id", billId)
      : supabase.from("bill_splits").select("*").eq("bill_id", billId),
  ]);

  const userIds = (participantResult.data ?? []).map((p) => p.user_id);
  if (!userIds.includes(billRow.creator_id)) {
    userIds.push(billRow.creator_id);
  }

  const payers: BillPayer[] = (payerResult.data ?? []).map((p) => ({
    userId: p.user_id,
    amountCents: p.amount_cents,
  }));

  const bill: Bill = {
    id: billRow.id,
    creatorId: billRow.creator_id,
    billType,
    title: billRow.title,
    merchantName: billRow.merchant_name ?? undefined,
    status: billRow.status,
    serviceFeePercent: billRow.service_fee_percent,
    fixedFees: billRow.fixed_fees,
    totalAmount: billRow.total_amount,
    totalAmountInput: (billRow as Record<string, unknown>).total_amount_input as number ?? 0,
    payers,
    groupId: (billRow as Record<string, unknown>).group_id as string | undefined ?? undefined,
    createdAt: billRow.created_at,
    updatedAt: billRow.updated_at,
  };

  let items: BillItem[] = [];
  let splits: ItemSplit[] = [];
  let billSplits: BillSplit[] = [];

  if (billType === "itemized") {
    items = (itemOrSplitResult.data ?? []).map((i: Record<string, unknown>) => ({
      id: i.id as string,
      billId: i.bill_id as string,
      description: i.description as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
      totalPriceCents: i.total_price_cents as number,
      createdAt: i.created_at as string,
    }));
  } else {
    billSplits = (itemOrSplitResult.data ?? []).map((s: Record<string, unknown>) => ({
      userId: s.user_id as string,
      splitType: s.split_type as "equal" | "percentage" | "fixed",
      value: Number(s.value),
      computedAmountCents: s.computed_amount_cents as number,
    }));
  }

  const itemIds = items.map((i) => i.id);
  const [profileResult, splitResult] = await Promise.all([
    userIds.length > 0
      ? supabase.from("user_profiles").select("*").in("id", userIds)
      : Promise.resolve({ data: [] }),
    billType === "itemized" && itemIds.length > 0
      ? supabase.from("item_splits").select("*").in("item_id", itemIds)
      : Promise.resolve({ data: [] }),
  ]);

  splits = (splitResult.data ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    itemId: s.item_id as string,
    userId: s.user_id as string,
    splitType: s.split_type as "equal" | "percentage" | "fixed",
    value: Number(s.value),
    computedAmountCents: s.computed_amount_cents as number,
  }));

  const participants: User[] = (profileResult.data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    email: "",
    handle: (p.handle as string) ?? "",
    name: p.name as string,
    pixKeyType: "email" as const,
    pixKeyHint: "",
    avatarUrl: (p.avatar_url as string) ?? undefined,
    onboarded: true,
    createdAt: "",
  }));

  const ledger: LedgerEntry[] = (ledgerResult.data ?? []).map((e) => ({
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
