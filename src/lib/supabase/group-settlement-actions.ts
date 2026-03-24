import { createClient } from "@/lib/supabase/client";
import type { Bill, BillPayer, BillStatus, GroupSettlement, LedgerEntry, User } from "@/types";
import type { DebtEdge } from "@/lib/simplify";

interface BillRow {
  id: string;
  creator_id: string;
  bill_type: string;
  title: string;
  merchant_name: string | null;
  status: BillStatus;
  service_fee_percent: number;
  fixed_fees: number;
  total_amount: number;
  total_amount_input: number | null;
  group_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GroupSettlementRow {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: "pending" | "paid_unconfirmed" | "settled";
  paid_at: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export async function loadGroupBillsAndLedger(groupId: string): Promise<{
  bills: Bill[];
  ledger: LedgerEntry[];
  participants: User[];
}> {
  const supabase = createClient();

  const { data: billRows } = await supabase
    .from("bills")
    .select("*")
    .eq("group_id", groupId)
    .neq("status", "draft");

  const bills: Bill[] = (billRows ?? []).map((b: BillRow) => {
    const payers: BillPayer[] = [];
    return {
      id: b.id,
      creatorId: b.creator_id,
      billType: b.bill_type === "single_amount" ? "single_amount" : "itemized",
      title: b.title,
      merchantName: b.merchant_name ?? undefined,
      status: b.status,
      serviceFeePercent: b.service_fee_percent,
      fixedFees: b.fixed_fees,
      totalAmount: b.total_amount,
      totalAmountInput: b.total_amount_input ?? 0,
      payers,
      groupId: b.group_id ?? undefined,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  });

  if (bills.length === 0) {
    return { bills, ledger: [], participants: [] };
  }

  const billIds = bills.map((b) => b.id);

  const { data: ledgerRows } = await supabase
    .from("ledger")
    .select("*")
    .in("bill_id", billIds);

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

  // Collect all participant IDs from bill_participants
  const { data: participantRows } = await supabase
    .from("bill_participants")
    .select("user_id")
    .in("bill_id", billIds);

  const participantIds = [...new Set((participantRows ?? []).map((p) => p.user_id))];

  let participants: User[] = [];
  if (participantIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("id", participantIds);

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

  return { bills, ledger, participants };
}

export async function loadGroupSettlements(groupId: string): Promise<GroupSettlement[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("group_settlements")
    .select("*")
    .eq("group_id", groupId);

  return (data ?? []).map((s: GroupSettlementRow) => ({
    id: s.id,
    groupId: s.group_id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    amountCents: s.amount_cents,
    status: s.status,
    paidAt: s.paid_at ?? undefined,
    confirmedAt: s.confirmed_at ?? undefined,
    createdAt: s.created_at,
  }));
}

export async function upsertGroupSettlements(
  groupId: string,
  edges: DebtEdge[],
): Promise<void> {
  const supabase = createClient();
  const existing = await loadGroupSettlements(groupId);

  // Build map by key "from->to"
  const existingMap = new Map<string, GroupSettlement[]>();
  for (const s of existing) {
    const key = `${s.fromUserId}->${s.toUserId}`;
    if (!existingMap.has(key)) existingMap.set(key, []);
    existingMap.get(key)!.push(s);
  }

  const toDelete: string[] = [];
  const toInsert: { group_id: string; from_user_id: string; to_user_id: string; amount_cents: number }[] = [];

  const processedKeys = new Set<string>();

  for (const edge of edges) {
    const key = `${edge.fromUserId}->${edge.toUserId}`;
    processedKeys.add(key);
    const existingForPair = existingMap.get(key) ?? [];

    // Sum already-settled or in-progress amounts
    const settledAmount = existingForPair
      .filter((s) => s.status !== "pending")
      .reduce((sum, s) => sum + s.amountCents, 0);

    // Delete pending rows for this pair
    for (const s of existingForPair.filter((s) => s.status === "pending")) {
      toDelete.push(s.id);
    }

    // Insert new pending row for remaining amount
    const remaining = edge.amountCents - settledAmount;
    if (remaining > 1) {
      toInsert.push({
        group_id: groupId,
        from_user_id: edge.fromUserId,
        to_user_id: edge.toUserId,
        amount_cents: remaining,
      });
    }
  }

  // Delete pending rows for edges that no longer exist
  for (const [key, entries] of existingMap) {
    if (!processedKeys.has(key)) {
      for (const s of entries) {
        if (s.status === "pending") toDelete.push(s.id);
      }
    }
  }

  if (toDelete.length > 0) {
    await supabase
      .from("group_settlements")
      .delete()
      .in("id", toDelete);
  }
  if (toInsert.length > 0) {
    await supabase
      .from("group_settlements")
      .insert(toInsert);
  }
}

export async function markGroupSettlementPaid(settlementId: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("group_settlements")
    .update({ status: "paid_unconfirmed", paid_at: new Date().toISOString() })
    .eq("id", settlementId);
}

export async function confirmGroupSettlement(settlementId: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("group_settlements")
    .update({ status: "settled", confirmed_at: new Date().toISOString() })
    .eq("id", settlementId);
}
