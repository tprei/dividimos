export type PixKeyType = "phone" | "cpf" | "email" | "random";

export type SplitType = "equal" | "percentage" | "fixed";

export type BillStatus = "draft" | "active" | "partially_settled" | "settled";

export type DebtStatus = "pending" | "paid_unconfirmed" | "settled";

export type BillType = "single_amount" | "itemized";

export type GroupMemberStatus = "invited" | "accepted";

export type BillParticipantStatus = "invited" | "accepted" | "declined";

export interface User {
  id: string;
  email: string;
  handle: string;
  name: string;
  phone?: string;
  pixKeyType: PixKeyType;
  pixKeyHint: string;
  avatarUrl?: string;
  onboarded: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
}

export interface Group {
  id: string;
  name: string;
  creatorId: string;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  status: GroupMemberStatus;
  invitedBy: string;
  createdAt: string;
  acceptedAt?: string;
  user?: UserProfile;
}

export interface GroupWithMembers extends Group {
  members: (GroupMember & { user: UserProfile })[];
}

export interface BillPayer {
  userId: string;
  amountCents: number;
}

export interface BillSplit {
  userId: string;
  splitType: SplitType;
  value: number;
  computedAmountCents: number;
}

export interface Bill {
  id: string;
  creatorId: string;
  billType: BillType;
  title: string;
  merchantName?: string;
  status: BillStatus;
  serviceFeePercent: number;
  fixedFees: number;
  totalAmount: number;
  totalAmountInput: number;
  payers: BillPayer[];
  createdAt: string;
  updatedAt: string;
}

export interface BillParticipant {
  billId: string;
  userId: string;
  status: BillParticipantStatus;
  invitedBy?: string;
  respondedAt?: string;
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
  billSplits: BillSplit[];
}
