import { createClient } from "@/lib/supabase/client";
import type { Bill, BillPayer, DebtStatus, ExpenseShare, GroupSettlement, User } from "@/types";
import type { DebtEdge } from "@/lib/simplify";
import type { Database } from "@/types/database";
import { isDebtStatus } from "@/lib/type-guards";
import { expenseShareRowToExpenseShare } from "@/lib/supabase/mappers";

type BillRow = Database["public"]["Tables"]["bills"]["Row"];
type ExpenseShareRow = Database["public"]["Tables"]["expense_shares"]["Row"];
type GroupSettlementRow = Database["public"]["Tables"]["group_settlements"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

export async function loadGroupBillsAndLedger(groupId: string): Promise<{
  bills: Bill[];
  shares: ExpenseShare[];
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
    return { bills, shares: [], participants: [] };
  }

  const billIds = bills.map((b) => b.id);

  const [sharesResult, participantResult] = await Promise.all([
    supabase.from("expense_shares").select("*").in("bill_id", billIds),
    supabase.from("bill_participants").select("user_id").in("bill_id", billIds),
  ]);
  const shares: ExpenseShare[] = (sharesResult.data as ExpenseShareRow[] ?? []).map(expenseShareRowToExpenseShare);
  const participantRows = participantResult.data;

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

  return { bills, shares, participants };
}

function mapSettlementRow(s: GroupSettlementRow): GroupSettlement {
  return {
    id: s.id,
    groupId: s.group_id,
    fromUserId: s.from_user_id,
    toUserId: s.to_user_id,
    amountCents: s.amount_cents,
    paidAmountCents: s.paid_amount_cents ?? 0,
    status: (isDebtStatus(s.status) ? s.status : "pending") as DebtStatus,
    paidAt: s.paid_at ?? undefined,
    createdAt: s.created_at,
  };
}

export async function loadGroupSettlements(groupId: string): Promise<GroupSettlement[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("group_settlements")
    .select("*")
    .eq("group_id", groupId);

  return (data as GroupSettlementRow[] ?? []).map(mapSettlementRow);
}

export async function syncGroupSettlements(
  groupId: string,
  edges: DebtEdge[],
): Promise<GroupSettlement[]> {
  const supabase = createClient();
  const { data } = await supabase.rpc("sync_group_settlements", {
    p_group_id: groupId,
    p_edges: edges.map((e) => ({
      from_user_id: e.fromUserId,
      to_user_id: e.toUserId,
      amount_cents: e.amountCents,
    })),
  });
  return (data as GroupSettlementRow[] ?? []).map(mapSettlementRow);
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

