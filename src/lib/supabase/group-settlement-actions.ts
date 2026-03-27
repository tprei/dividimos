import { createClient } from "@/lib/supabase/client";
import type { Bill, BillPayer, DebtStatus, GroupSettlement, LedgerEntry, User } from "@/types";
import type { DebtEdge } from "@/lib/simplify";
import type { Database } from "@/types/database";
import { isDebtStatus } from "@/lib/type-guards";

type BillRow = Database["public"]["Tables"]["bills"]["Row"];
type LedgerRow = Database["public"]["Tables"]["ledger"]["Row"];
type GroupSettlementRow = Database["public"]["Tables"]["group_settlements"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

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

  const bills: Bill[] = (billRows as BillRow[] ?? []).map((b) => {
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
      totalAmountInput: b.total_amount_input,
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

  const [ledgerResult, participantResult] = await Promise.all([
    supabase.from("ledger").select("*").in("bill_id", billIds),
    supabase.from("bill_participants").select("user_id").in("bill_id", billIds),
  ]);
  const ledgerRows = ledgerResult.data;
  const participantRows = participantResult.data;

  const ledger: LedgerEntry[] = (ledgerRows as LedgerRow[] ?? []).map((e) => ({
    id: e.id,
    billId: e.bill_id ?? undefined,
    entryType: e.entry_type ?? ("debt" as const),
    groupId: e.group_id ?? undefined,
    fromUserId: e.from_user_id,
    toUserId: e.to_user_id,
    amountCents: e.amount_cents,
    paidAmountCents: e.paid_amount_cents ?? 0,
    status: (isDebtStatus(e.status) ? e.status : "pending") as DebtStatus,
    paidAt: e.paid_at ?? undefined,
    createdAt: e.created_at,
  }));

  const participantIds = [...new Set((participantRows ?? []).map((p) => p.user_id))];

  let participants: User[] = [];
  if (participantIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("id", participantIds);

    participants = (profiles as UserProfileRow[] ?? []).map((p) => ({
      id: p.id,
      email: "",
      handle: p.handle,
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

  return (data as GroupSettlementRow[] ?? []).map((s) => ({
    id: s.id,
    groupId: s.group_id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    amountCents: s.amount_cents,
    paidAmountCents: s.paid_amount_cents ?? 0,
    status: (isDebtStatus(s.status) ? s.status : "pending") as DebtStatus,
    paidAt: s.paid_at ?? undefined,
    createdAt: s.created_at,
  }));
}

export async function upsertGroupSettlements(
  groupId: string,
  edges: DebtEdge[],
): Promise<GroupSettlement[]> {
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

  await Promise.all([
    toDelete.length > 0 ? supabase.from("group_settlements").delete().in("id", toDelete) : null,
    toInsert.length > 0 ? supabase.from("group_settlements").insert(toInsert) : null,
  ]);

  const surviving = existing.filter((s) => !toDelete.includes(s.id));
  const inserted: GroupSettlement[] = toInsert.map((row) => ({
    id: "",
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountCents: row.amount_cents,
    paidAmountCents: 0,
    status: "pending" as DebtStatus,
    paidAt: undefined,
    createdAt: new Date().toISOString(),
  }));
  return [...surviving, ...inserted];
}

export async function markGroupSettlementPaid(
  settlementId: string,
  amountCents: number,
  fromUserId: string,
  toUserId: string,
): Promise<{ error?: string }> {
  const supabase = createClient();

  const { error } = await supabase
    .from("payments")
    .insert({
      group_settlement_id: settlementId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    });

  return { error: error?.message };
}

