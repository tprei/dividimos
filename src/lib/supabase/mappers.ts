/**
 * Type-safe mappers between database snake_case rows and application camelCase types.
 */
import type {
  Bill,
  BillItem,
  BillPayer,
  BillSplit,
  ItemSplit,
  LedgerEntry,
  User,
} from "@/types";
import type { Database } from "@/types/database";
import { coerceBillType, coerceSplitType, coerceDebtStatus } from "@/lib/type-guards";

type BillRow = Database["public"]["Tables"]["bills"]["Row"];
type BillItemRow = Database["public"]["Tables"]["bill_items"]["Row"];
type BillPayerRow = Database["public"]["Tables"]["bill_payers"]["Row"];
type BillSplitRow = Database["public"]["Tables"]["bill_splits"]["Row"];
type ItemSplitRow = Database["public"]["Tables"]["item_splits"]["Row"];
type LedgerRow = Database["public"]["Tables"]["ledger"]["Row"];
type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

export function billRowToBill(row: BillRow): Bill {
  return {
    id: row.id,
    creatorId: row.creator_id,
    billType: coerceBillType(row.bill_type, "itemized"),
    title: row.title,
    merchantName: row.merchant_name ?? undefined,
    status: row.status,
    serviceFeePercent: row.service_fee_percent,
    fixedFees: row.fixed_fees,
    totalAmount: row.total_amount,
    totalAmountInput: row.total_amount_input,
    payers: [],
    groupId: row.group_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function billItemRowToBillItem(row: BillItemRow): BillItem {
  return {
    id: row.id,
    billId: row.bill_id,
    description: row.description,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    totalPriceCents: row.total_price_cents,
    createdAt: row.created_at,
  };
}

export function billPayerRowToBillPayer(row: BillPayerRow): BillPayer {
  return {
    userId: row.user_id,
    amountCents: row.amount_cents,
  };
}

export function billSplitRowToBillSplit(row: BillSplitRow): BillSplit {
  return {
    userId: row.user_id,
    splitType: coerceSplitType(row.split_type, "equal"),
    value: row.value,
    computedAmountCents: row.computed_amount_cents,
  };
}

export function itemSplitRowToItemSplit(row: ItemSplitRow): ItemSplit {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    splitType: row.split_type,
    value: row.value,
    computedAmountCents: row.computed_amount_cents,
  };
}

export function ledgerRowToLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    billId: row.bill_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountCents: row.amount_cents,
    status: coerceDebtStatus(row.status, "pending"),
    paidAt: row.paid_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function userProfileRowToUser(row: UserProfileRow): User {
  return {
    id: row.id,
    email: "",
    handle: row.handle,
    name: row.name,
    pixKeyType: "email",
    pixKeyHint: "",
    avatarUrl: row.avatar_url ?? undefined,
    onboarded: true,
    createdAt: "",
  };
}
