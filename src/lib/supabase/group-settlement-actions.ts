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

export async function syncGroupSettlements(
  groupId: string,
  edges: DebtEdge[],
): Promise<GroupSettlement[]> {
  const supabase = createClient();

  const p_edges = edges.map((e) => ({
    from_user_id: e.fromUserId,
    to_user_id: e.toUserId,
    amount_cents: e.amountCents,
  }));

  const { data, error } = await supabase.rpc("sync_group_settlements", {
    p_group_id: groupId,
    p_edges,
  });

  if (error) {
    console.error("sync_group_settlements RPC failed:", error.message);
    return [];
  }

  return ((data as GroupSettlementRow[]) ?? []).map((s) => ({
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

export async function markGroupSettlementPaid(
  settlementId: string,
  amountCents: number,
  fromUserId: string,
  toUserId: string,
): Promise<{ paymentId?: string; error?: string }> {
  if (!settlementId) {
    return { error: "Settlement ID is required" };
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("payments")
    .insert({
      group_settlement_id: settlementId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  return { paymentId: data.id };
}

