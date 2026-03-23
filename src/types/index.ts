export type PixKeyType = "phone" | "cpf" | "email" | "random";

export type SplitType = "equal" | "percentage" | "fixed";

export type BillStatus = "draft" | "active" | "partially_settled" | "settled";

export type DebtStatus = "pending" | "paid_unconfirmed" | "settled";

export interface User {
  id: string;
  phone: string;
  name: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  avatarUrl?: string;
  createdAt: string;
}

export interface Bill {
  id: string;
  creatorId: string;
  title: string;
  merchantName?: string;
  status: BillStatus;
  serviceFeePercent: number;
  fixedFees: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillParticipant {
  billId: string;
  userId: string;
  user?: User;
  joinedAt: string;
}

export interface BillItem {
  id: string;
  billId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  createdAt: string;
}

export interface ItemSplit {
  id: string;
  itemId: string;
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

export interface LedgerEntry {
  id: string;
  billId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: DebtStatus;
  paidAt?: string;
  confirmedAt?: string;
  createdAt: string;
}

export interface ParticipantSummary {
  userId: string;
  user: User;
  itemsTotal: number;
  serviceFee: number;
  fixedFeeShare: number;
  grandTotal: number;
  debts: DebtSummary[];
}

export interface DebtSummary {
  toUserId: string;
  toUser: User;
  amountCents: number;
  status: DebtStatus;
}

export interface BillWithDetails extends Bill {
  participants: (BillParticipant & { user: User })[];
  items: (BillItem & { splits: (ItemSplit & { user: User })[] })[];
  ledger: LedgerEntry[];
}
