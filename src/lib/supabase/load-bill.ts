import { createClient } from "@/lib/supabase/client";
import {
  billRowToBill,
  billItemRowToBillItem,
  billPayerRowToBillPayer,
  billSplitRowToBillSplit,
  itemSplitRowToItemSplit,
  expenseShareRowToExpenseShare,
  userProfileRowToUser,
} from "@/lib/supabase/mappers";
import type { Bill, BillItem, BillPayer, BillSplit, ExpenseShare, ItemSplit, User } from "@/types";
import type { Database } from "@/types/database";

type BillRow = Database["public"]["Tables"]["bills"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

interface BillWithRelations {
  id: string;
  creator_id: string;
  title: string;
  merchant_name: string | null;
  bill_type: string;
  status: "draft" | "active" | "partially_settled" | "settled";
  service_fee_percent: number;
  fixed_fees: number;
  total_amount: number;
  total_amount_input: number;
  group_id: string | null;
  created_at: string;
  updated_at: string;
  bill_participants: Array<{
    user_id: string;
    status: string;
  }>;
  bill_payers: Array<{ bill_id: string; user_id: string; amount_cents: number }>;
  expense_shares: Array<{
    bill_id: string;
    user_id: string;
    paid_cents: number;
    owed_cents: number;
    net_cents: number;
    created_at: string;
  }>;
  bill_items: Array<{
    id: string;
    bill_id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    total_price_cents: number;
    created_at: string;
    item_splits: Array<{
      id: string;
      item_id: string;
      user_id: string;
      split_type: "equal" | "percentage" | "fixed";
      value: number;
      computed_amount_cents: number;
    }>;
  }>;
  bill_splits: Array<{
    id: string;
    bill_id: string;
    user_id: string;
    split_type: string;
    value: number;
    computed_amount_cents: number;
  }>;
}

interface LoadedBill {
  bill: Bill;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  shares: ExpenseShare[];
  participantStatuses: Map<string, string>;
}

export async function loadBillFromSupabase(billId: string): Promise<LoadedBill | null> {
  const supabase = createClient();

  const { data } = await supabase
    .from("bills")
    .select(
      "*, bill_participants(user_id, status), bill_payers(*), expense_shares(*), bill_items(*, item_splits(*)), bill_splits(*)"
    )
    .eq("id", billId)
    .single();

  if (!data) return null;

  const row = data as unknown as BillWithRelations;

  const participantStatuses = new Map<string, string>();
  for (const p of row.bill_participants) {
    participantStatuses.set(p.user_id, p.status);
  }

  const allUserIds = [...new Set([
    row.creator_id,
    ...row.bill_participants.map((p) => p.user_id),
  ])];

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("*")
    .in("id", allUserIds);

  const profileRows = (profiles ?? []) as unknown as UserProfileRow[];

  const payers: BillPayer[] = row.bill_payers.map(billPayerRowToBillPayer);

  const bill: Bill = {
    ...billRowToBill(row as unknown as BillRow),
    payers,
  };

  const billType = row.bill_type === "single_amount" ? "single_amount" : "itemized";

  const items: BillItem[] =
    billType === "itemized" ? row.bill_items.map(billItemRowToBillItem) : [];

  const splits: ItemSplit[] =
    billType === "itemized"
      ? row.bill_items.flatMap((item) => item.item_splits.map(itemSplitRowToItemSplit))
      : [];

  const billSplits: BillSplit[] =
    billType === "single_amount" ? row.bill_splits.map(billSplitRowToBillSplit) : [];

  const shares: ExpenseShare[] = row.expense_shares.map(expenseShareRowToExpenseShare);

  const participants: User[] = profileRows.map(userProfileRowToUser);

  return { bill, participants, items, splits, billSplits, shares, participantStatuses };
}
