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
type BillItemRow = Database["public"]["Tables"]["bill_items"]["Row"];
type BillPayerRow = Database["public"]["Tables"]["bill_payers"]["Row"];
type BillSplitRow = Database["public"]["Tables"]["bill_splits"]["Row"];
type ItemSplitRow = Database["public"]["Tables"]["item_splits"]["Row"];
type LedgerRow = Database["public"]["Tables"]["ledger"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

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

  const { data: billRow } = await supabase
    .from("bills")
    .select("*")
    .eq("id", billId)
    .single();

  if (!billRow) return null;

  const typedBillRow = billRow as BillRow;
  const billType = typedBillRow.bill_type === "single_amount" ? "single_amount" : "itemized";

  const [participantResult, payerResult, ledgerResult, itemOrSplitResult] = await Promise.all([
    supabase.from("bill_participants").select("user_id, status").eq("bill_id", billId),
    supabase.from("bill_payers").select("*").eq("bill_id", billId),
    supabase.from("ledger").select("*").eq("bill_id", billId),
    billType === "itemized"
      ? supabase.from("bill_items").select("*").eq("bill_id", billId)
      : supabase.from("bill_splits").select("*").eq("bill_id", billId),
  ]);

  const participantStatuses = new Map<string, string>();
  for (const row of (participantResult.data ?? [])) {
    participantStatuses.set(row.user_id, row.status);
  }

  const userIds = (participantResult.data ?? []).map((p) => p.user_id);
  if (!userIds.includes(typedBillRow.creator_id)) {
    userIds.push(typedBillRow.creator_id);
  }

  const payers: BillPayer[] = (payerResult.data as BillPayerRow[] ?? []).map(billPayerRowToBillPayer);

  const bill: Bill = {
    ...billRowToBill(typedBillRow),
    payers,
  };

  let items: BillItem[] = [];
  let splits: ItemSplit[] = [];
  let billSplits: BillSplit[] = [];

  if (billType === "itemized") {
    items = (itemOrSplitResult.data as BillItemRow[] ?? []).map(billItemRowToBillItem);
  } else {
    billSplits = (itemOrSplitResult.data as BillSplitRow[] ?? []).map(billSplitRowToBillSplit);
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

  splits = (splitResult.data as ItemSplitRow[] ?? []).map(itemSplitRowToItemSplit);

  const participants: User[] = (profileResult.data as UserProfileRow[] ?? []).map(userProfileRowToUser);

  const ledger: LedgerEntry[] = (ledgerResult.data as LedgerRow[] ?? []).map(ledgerRowToLedgerEntry);

  return { bill, participants, items, splits, billSplits, ledger, participantStatuses };
}
