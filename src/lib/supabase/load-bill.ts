import { createClient } from "@/lib/supabase/client";
import {
  billRowToBill,
  billItemRowToBillItem,
  billPayerRowToBillPayer,
  billSplitRowToBillSplit,
  itemSplitRowToItemSplit,
  ledgerRowToLedgerEntry,
  userProfileRowToUser,
} from "@/lib/supabase/mappers";
import type { Bill, BillItem, BillPayer, BillSplit, ItemSplit, LedgerEntry, User } from "@/types";
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
  ledger: Array<{
    id: string;
    bill_id: string | null;
    entry_type: "debt" | "payment";
    group_id: string | null;
    from_user_id: string;
    to_user_id: string;
    amount_cents: number;
    paid_amount_cents: number;
    status: "pending" | "partially_paid" | "settled";
    paid_at: string | null;
    confirmed_at: string | null;
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
  ledger: LedgerEntry[];
  participantStatuses: Map<string, string>;
}

export async function loadBillFromSupabase(billId: string): Promise<LoadedBill | null> {
  const supabase = createClient();

  const { data } = await supabase
    .from("bills")
    .select(
      "*, bill_participants(user_id, status), bill_payers(*), ledger(*), bill_items(*, item_splits(*)), bill_splits(*)"
    )
    .eq("id", billId)
    .single();

  if (!data) return null;

  const row = data as unknown as BillWithRelations;

  const participantStatuses = new Map<string, string>();
  for (const p of row.bill_participants) {
    participantStatuses.set(p.user_id, p.status);
  }

  // Collect all user IDs (participants + creator) and batch-fetch from user_profiles view
  const userIds = new Set<string>(row.bill_participants.map((p) => p.user_id));
  userIds.add(row.creator_id);

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("*")
    .in("id", [...userIds]);

  const profileRows: UserProfileRow[] = (profiles ?? []) as UserProfileRow[];

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

  const ledger: LedgerEntry[] = row.ledger.map(ledgerRowToLedgerEntry);

  const participants: User[] = profileRows.map(userProfileRowToUser);

  return { bill, participants, items, splits, billSplits, ledger, participantStatuses };
}
