// One-off ledger migration (spec §9.1): copies the legacy schema into the
// ledger-first baseline inside a single transaction, then reconciles balances.
//
// Usage:
//   npx tsx scripts/migrate-ledger.ts [--dry-run] [OLD_DATABASE_URL] [NEW_DATABASE_URL]
//
// The connection strings fall back to the OLD_DATABASE_URL / NEW_DATABASE_URL
// env vars. The old database is only read.

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { ExpensePayload, ParticipantRef } from "../src/types/ledger";

const BATCH_SIZE = 500;

type Column = {
  name: string;
  expr?: (placeholder: string) => string;
};

type MigrationOptions = {
  oldUrl: string;
  newUrl: string;
  dryRun: boolean;
};

type OldUser = {
  id: string;
  handle: string | null;
  name: string;
  email: string | null;
  avatar_url: string | null;
  pix_key_type: string | null;
  pix_key_hint: string | null;
  pix_key_encrypted: string | null;
  onboarded: boolean;
  notification_preferences: unknown;
  created_at: Date;
};

type OldGroup = {
  id: string;
  name: string;
  creator_id: string;
  is_dm: boolean;
  created_at: Date;
};

type OldDmPair = {
  group_id: string;
  user_a: string;
  user_b: string;
};

type OldGroupMember = {
  group_id: string;
  user_id: string;
  status: string;
  invited_by: string;
  created_at: Date;
  accepted_at: Date | null;
};

type OldInviteLink = {
  id: string;
  group_id: string;
  token: string;
  created_by: string;
  is_active: boolean;
  expires_at: Date | null;
  max_uses: number | null;
  use_count: number;
  created_at: Date;
};

type OldPushSubscription = {
  id: string;
  user_id: string;
  subscription: string;
  channel: string;
  created_at: Date;
};

type OldVendorCharge = {
  id: string;
  user_id: string;
  amount_cents: number;
  description: string | null;
  status: string;
  created_at: Date;
  confirmed_at: Date | null;
};

type OldExpense = {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  merchant_name: string | null;
  expense_type: string;
  total_amount: number;
  service_fee_basis_points: number;
  fixed_fees: number;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type OldExpenseItem = {
  id: string;
  expense_id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
};

type OldExpenseShare = {
  id: string;
  expense_id: string;
  user_id: string;
  share_amount_cents: number;
};

type OldExpenseGuest = {
  id: string;
  expense_id: string;
  display_name: string;
  claimed_by: string | null;
  claimed_at: Date | null;
  created_at: Date;
};

type OldExpenseGuestShare = {
  id: string;
  expense_id: string;
  guest_id: string;
  share_amount_cents: number;
};

type OldExpensePayer = {
  expense_id: string;
  user_id: string;
  amount_cents: number;
};

type OldSettlement = {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: string;
  created_at: Date;
  confirmed_at: Date | null;
};

type MigratedSettlement = {
  settlementId: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: string;
  confirmedAt: Date | null;
  createdAt: Date;
};

type OldChatMessage = {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
};

type OldConversationRead = {
  user_id: string;
  group_id: string;
  last_read_at: Date;
};

type OldBalance = {
  group_id: string;
  user_a: string;
  user_b: string;
  amount_cents: number;
};

type OldGuestPendingNet = {
  group_id: string;
  guest_id: string;
  net: string;
};

type OldGuestCredit = {
  group_id: string;
  user_id: string;
  credit: string;
};
type NewGroupBalance = {
  group_id: string;
  participant_id: string;
  net_cents: string;
};

type Participant =
  | { kind: "user"; userId: string; share: number; paid: number }
  | { kind: "guest"; guestId: string; displayName: string; share: number };

type MigratedExpense = {
  expenseId: string;
  groupId: string;
  creatorId: string;
  title: string;
  totalCents: number;
  createdAt: Date;
};

type Mismatch = {
  group_id: string;
  participant_id: string;
  old_net: number | null;
  new_net: number | null;
};

const USAGE = [
  "usage: npx tsx scripts/migrate-ledger.ts [--dry-run] [OLD_DATABASE_URL] [NEW_DATABASE_URL]",
  "connection strings fall back to the OLD_DATABASE_URL / NEW_DATABASE_URL env vars",
].join("\n");

function parseOptions(argv: string[]): MigrationOptions {
  const positional: string[] = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else {
      positional.push(arg);
    }
  }
  const oldUrl = positional[0] ?? process.env.OLD_DATABASE_URL;
  const newUrl = positional[1] ?? process.env.NEW_DATABASE_URL;
  if (!oldUrl || !newUrl) {
    throw new Error(USAGE);
  }
  return { oldUrl, newUrl, dryRun };
}

async function insertRows(
  client: Client,
  table: string,
  columns: Column[],
  rows: unknown[][],
): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const chunk = rows.slice(start, start + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      const rendered = columns.map((column, i) =>
        column.expr ? column.expr(placeholders[i]) : placeholders[i],
      );
      return `(${rendered.join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.map((c) => c.name).join(", ")}) VALUES ${tuples.join(", ")}`,
      values,
    );
    inserted += chunk.length;
  }
  return inserted;
}

function serviceFeeCents(subtotal: number, basisPoints: number): number {
  return Math.floor((subtotal * basisPoints + 5000) / 10000);
}

function expectSum(context: string, label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${context}: ${label} sum to ${actual}, expected ${expected}`);
  }
}

async function copyUsers(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldUser>(
    `SELECT id, handle, name, email, avatar_url, pix_key_type, pix_key_hint, pix_key_encrypted,
            onboarded, notification_preferences, created_at
       FROM public.users
      ORDER BY id`,
  );
  return insertRows(
    newDb,
    "public.users",
    [
      { name: "id" },
      { name: "handle" },
      { name: "name" },
      { name: "email" },
      { name: "avatar_url" },
      { name: "pix_key_type" },
      { name: "pix_key_hint" },
      { name: "pix_key_encrypted" },
      { name: "onboarded" },
      { name: "notification_preferences" },
      { name: "created_at" },
      { name: "updated_at" },
    ],
    rows.map((row) => [
      row.id,
      row.handle,
      row.name,
      row.email,
      row.avatar_url,
      row.pix_key_type,
      row.pix_key_hint,
      row.pix_key_encrypted,
      row.onboarded,
      row.notification_preferences,
      row.created_at,
      row.created_at,
    ]),
  );
}

async function copyGroups(oldDb: Client, newDb: Client): Promise<number> {
  const { rows: groups } = await oldDb.query<OldGroup>(
    "SELECT id, name, creator_id, is_dm, created_at FROM public.groups ORDER BY id",
  );
  const { rows: dmPairs } = await oldDb.query<OldDmPair>(
    "SELECT group_id, user_a, user_b FROM public.dm_pairs",
  );
  const pairByGroup = new Map(dmPairs.map((pair) => [pair.group_id, pair]));
  return insertRows(
    newDb,
    "public.groups",
    [
      { name: "id" },
      { name: "kind" },
      { name: "name" },
      { name: "creator_id" },
      { name: "dm_user_a" },
      { name: "dm_user_b" },
      { name: "created_at" },
    ],
    groups.map((group) => {
      const pair = group.is_dm ? pairByGroup.get(group.id) : undefined;
      if (group.is_dm && !pair) {
        throw new Error(`dm group ${group.id} has no dm_pairs row`);
      }
      return [
        group.id,
        group.is_dm ? "dm" : "group",
        group.is_dm ? "" : group.name,
        group.creator_id,
        pair?.user_a ?? null,
        pair?.user_b ?? null,
        group.created_at,
      ];
    }),
  );
}

async function copyGroupMembers(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldGroupMember>(
    `SELECT group_id, user_id, status, invited_by, created_at, accepted_at
       FROM public.group_members
      WHERE status::text <> 'declined'
      ORDER BY group_id, user_id`,
  );
  return insertRows(
    newDb,
    "public.group_members",
    [
      { name: "group_id" },
      { name: "user_id" },
      { name: "status" },
      { name: "invited_by" },
      { name: "created_at" },
      { name: "accepted_at" },
    ],
    rows.map((row) => [
      row.group_id,
      row.user_id,
      row.status,
      row.invited_by,
      row.created_at,
      row.accepted_at,
    ]),
  );
}

async function copyGroupInviteLinks(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldInviteLink>(
    `SELECT id, group_id, token, created_by, is_active, expires_at, max_uses, use_count, created_at
       FROM public.group_invite_links
      ORDER BY id`,
  );
  return insertRows(
    newDb,
    "public.group_invite_links",
    [
      { name: "id" },
      { name: "group_id" },
      { name: "token" },
      { name: "created_by" },
      { name: "is_active" },
      { name: "expires_at" },
      { name: "max_uses" },
      { name: "use_count" },
      { name: "created_at" },
    ],
    rows.map((row) => [
      row.id,
      row.group_id,
      row.token,
      row.created_by,
      row.is_active,
      row.expires_at,
      row.max_uses,
      row.use_count,
      row.created_at,
    ]),
  );
}

async function copyPushSubscriptions(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldPushSubscription>(
    "SELECT id, user_id, subscription, channel, created_at FROM public.push_subscriptions ORDER BY id",
  );
  return insertRows(
    newDb,
    "public.push_subscriptions",
    [
      { name: "id" },
      { name: "user_id" },
      { name: "channel" },
      { name: "subscription_encrypted" },
      {
        name: "endpoint_digest",
        expr: (placeholder) => `extensions.digest(convert_to(${placeholder}, 'utf8'), 'sha256')`,
      },
      { name: "created_at" },
    ],
    rows.map((row) => [row.id, row.user_id, row.channel, row.subscription, row.subscription, row.created_at]),
  );
}

async function copyVendorCharges(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldVendorCharge>(
    `SELECT id, user_id, amount_cents, description, status, created_at, confirmed_at
       FROM public.vendor_charges
      ORDER BY id`,
  );
  return insertRows(
    newDb,
    "public.vendor_charges",
    [
      { name: "id" },
      { name: "user_id" },
      { name: "amount_cents" },
      { name: "description" },
      { name: "status" },
      { name: "created_at" },
      { name: "confirmed_at" },
    ],
    rows.map((row) => [
      row.id,
      row.user_id,
      row.amount_cents,
      row.description,
      row.status,
      row.created_at,
      row.confirmed_at,
    ]),
  );
}

function buildPayload(
  expense: OldExpense,
  items: OldExpenseItem[],
  shares: OldExpenseShare[],
  guestShares: OldExpenseGuestShare[],
  guests: OldExpenseGuest[],
  payers: OldExpensePayer[],
): { payload: ExpensePayload; participants: Participant[] } {
  const guestsById = new Map(guests.map((guest) => [guest.id, guest]));
  const guestShareByGuest = new Map(guestShares.map((share) => [share.guest_id, share]));
  const payerByUser = new Map(payers.map((payer) => [payer.user_id, payer.amount_cents]));

  const users: Participant[] = shares.map((share) => ({
    kind: "user",
    userId: share.user_id,
    share: share.share_amount_cents,
    paid: payerByUser.get(share.user_id) ?? 0,
  }));
  for (const payer of payers) {
    if (!shares.some((share) => share.user_id === payer.user_id)) {
      users.push({ kind: "user", userId: payer.user_id, share: 0, paid: payer.amount_cents });
    }
  }
  const guestParticipants: Participant[] = [];
  for (const share of guestShares) {
    const guest = guestsById.get(share.guest_id);
    if (!guest) {
      throw new Error(`expense ${expense.id}: guest share references unknown guest ${share.guest_id}`);
    }
    if (guest.claimed_by !== null) {
      continue;
    }
    guestParticipants.push({
      kind: "guest",
      guestId: guest.id,
      displayName: guest.display_name,
      share: share.share_amount_cents,
    });
  }
  for (const guest of guests) {
    if (guest.claimed_by === null && !guestShareByGuest.has(guest.id)) {
      guestParticipants.push({
        kind: "guest",
        guestId: guest.id,
        displayName: guest.display_name,
        share: 0,
      });
    }
  }

  const participants = [...users, ...guestParticipants];
  const shareSum =
    users.reduce((total, participant) => total + participant.share, 0) +
    guestParticipants.reduce((total, participant) => total + participant.share, 0);
  expectSum(`expense ${expense.id}`, "shares", shareSum, expense.total_amount);
  expectSum(
    `expense ${expense.id}`,
    "payers",
    payers.reduce((total, payer) => total + payer.amount_cents, 0),
    expense.total_amount,
  );

  if (expense.expense_type === "itemized") {
    const itemsSum = items.reduce((total, item) => total + item.total_price_cents, 0);
    expectSum(
      `expense ${expense.id}`,
      "items + fees",
      itemsSum + serviceFeeCents(itemsSum, expense.service_fee_basis_points) + expense.fixed_fees,
      expense.total_amount,
    );
  }

  const payload: ExpensePayload = {
    items: items.map((item) => ({
      description: item.description,
      quantityMilliunits: item.quantity,
      unitPriceCents: item.unit_price_cents,
      totalPriceCents: item.total_price_cents,
    })),
    participants: participants.map((participant): ParticipantRef =>
      participant.kind === "user"
        ? { kind: "user", userId: participant.userId }
        : { kind: "guest", guestId: participant.guestId, displayName: participant.displayName },
    ),
    shares: participants.map((participant) => participant.share),
    payers: participants.flatMap((participant, index) =>
      participant.kind === "user" && payerByUser.has(participant.userId)
        ? [{ participantIndex: index, amountCents: payerByUser.get(participant.userId) ?? 0 }]
        : [],
    ),
    itemAssignments: null,
  };
  return { payload, participants };
}

async function migrateExpenses(
  oldDb: Client,
  newDb: Client,
): Promise<{ migrated: MigratedExpense[]; skippedDrafts: number }> {
  const { rows: expenses } = await oldDb.query<OldExpense>(
    `SELECT id, group_id, creator_id, title, merchant_name, expense_type, total_amount,
            service_fee_basis_points, fixed_fees, status, created_at, updated_at
       FROM public.expenses
      WHERE status IN ('active', 'settled')
      ORDER BY id`,
  );
  const { rows: draftRows } = await oldDb.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.expenses WHERE status = 'draft'",
  );
  const expenseIds = expenses.map((expense) => expense.id);

  const { rows: items } = await oldDb.query<OldExpenseItem>(
    `SELECT id, expense_id, description, quantity, unit_price_cents, total_price_cents
       FROM public.expense_items
      WHERE expense_id = ANY($1::uuid[])
      ORDER BY id`,
    [expenseIds],
  );
  const { rows: shares } = await oldDb.query<OldExpenseShare>(
    `SELECT id, expense_id, user_id, share_amount_cents
       FROM public.expense_shares
      WHERE expense_id = ANY($1::uuid[])
      ORDER BY id`,
    [expenseIds],
  );
  const { rows: guests } = await oldDb.query<OldExpenseGuest>(
    `SELECT id, expense_id, display_name, claimed_by, claimed_at, created_at
       FROM public.expense_guests
      WHERE expense_id = ANY($1::uuid[])
      ORDER BY id`,
    [expenseIds],
  );
  const { rows: guestShares } = await oldDb.query<OldExpenseGuestShare>(
    `SELECT id, expense_id, guest_id, share_amount_cents
       FROM public.expense_guest_shares
      WHERE expense_id = ANY($1::uuid[])
      ORDER BY id`,
    [expenseIds],
  );
  const { rows: payers } = await oldDb.query<OldExpensePayer>(
    `SELECT expense_id, user_id, amount_cents
       FROM public.expense_payers
      WHERE expense_id = ANY($1::uuid[])
      ORDER BY expense_id, user_id`,
    [expenseIds],
  );

  const byExpense = <T extends { expense_id: string }>(rows: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const bucket = map.get(row.expense_id);
      if (bucket) {
        bucket.push(row);
      } else {
        map.set(row.expense_id, [row]);
      }
    }
    return map;
  };

  const itemsByExpense = byExpense(items);
  const sharesByExpense = byExpense(shares);
  const guestsByExpense = byExpense(guests);
  const guestSharesByExpense = byExpense(guestShares);
  const payersByExpense = byExpense(payers);

  const expenseRows: unknown[][] = [];
  const versionRows: unknown[][] = [];
  const guestRows: unknown[][] = [];
  const participantRows: unknown[][] = [];
  const migrated: MigratedExpense[] = [];

  for (const expense of expenses) {
    const expenseId = randomUUID();
    const { payload, participants } = buildPayload(
      expense,
      itemsByExpense.get(expense.id) ?? [],
      sharesByExpense.get(expense.id) ?? [],
      guestSharesByExpense.get(expense.id) ?? [],
      guestsByExpense.get(expense.id) ?? [],
      payersByExpense.get(expense.id) ?? [],
    );

    expenseRows.push([
      expenseId,
      expense.id,
      expense.group_id,
      expense.creator_id,
      "active",
      expense.created_at,
    ]);
    versionRows.push([
      expenseId,
      1,
      expense.creator_id,
      expense.updated_at,
      expense.title,
      expense.merchant_name,
      expense.expense_type,
      expense.total_amount,
      expense.service_fee_basis_points,
      expense.fixed_fees,
      payload,
      null,
    ]);
    for (const guest of guestsByExpense.get(expense.id) ?? []) {
      guestRows.push([
        guest.id,
        expenseId,
        guest.display_name,
        guest.claimed_by,
        guest.claimed_at,
        guest.created_at,
      ]);
    }
    participants.forEach((participant, index) => {
      participantRows.push(
        participant.kind === "user"
          ? [expenseId, index, "user", participant.userId, null, participant.share, participant.paid]
          : [expenseId, index, "guest", null, participant.guestId, participant.share, 0],
      );
    });
    migrated.push({
      expenseId,
      groupId: expense.group_id,
      creatorId: expense.creator_id,
      title: expense.title,
      totalCents: expense.total_amount,
      createdAt: expense.created_at,
    });
  }

  const expenseCount = await insertRows(
    newDb,
    "public.expenses",
    [
      { name: "id" },
      { name: "client_id" },
      { name: "group_id" },
      { name: "creator_id" },
      { name: "status" },
      { name: "occurred_on", expr: (placeholder) => `(${placeholder}::timestamptz)::date` },
      { name: "created_at" },
    ],
    expenseRows.map(([id, clientId, groupId, creatorId, status, createdAt]) => [
      id,
      clientId,
      groupId,
      creatorId,
      status,
      createdAt,
      createdAt,
    ]),
  );
  const versionCount = await insertRows(
    newDb,
    "public.expense_versions",
    [
      { name: "expense_id" },
      { name: "version_no" },
      { name: "author_id" },
      { name: "created_at" },
      { name: "title" },
      { name: "merchant_name" },
      { name: "expense_type" },
      { name: "total_cents" },
      { name: "service_fee_bps" },
      { name: "fixed_fee_cents" },
      { name: "payload" },
      { name: "change_summary" },
    ],
    versionRows,
  );
  const guestCount = await insertRows(
    newDb,
    "public.guests",
    [
      { name: "id" },
      { name: "expense_id" },
      { name: "display_name" },
      { name: "claimed_by" },
      { name: "claimed_at" },
      { name: "created_at" },
    ],
    guestRows,
  );
  const participantCount = await insertRows(
    newDb,
    "public.expense_participants",
    [
      { name: "expense_id" },
      { name: "participant_index" },
      { name: "kind" },
      { name: "user_id" },
      { name: "guest_id" },
      { name: "share_cents" },
      { name: "paid_cents" },
    ],
    participantRows,
  );
  console.log(`  expenses: ${expenseCount}`);
  console.log(`  expense_versions: ${versionCount}`);
  console.log(`  guests: ${guestCount}`);
  console.log(`  expense_participants: ${participantCount}`);
  return { migrated, skippedDrafts: draftRows[0]?.n ?? 0 };
}

async function migrateSettlements(
  oldDb: Client,
  newDb: Client,
): Promise<{ count: number; migrated: MigratedSettlement[] }> {
  const { rows } = await oldDb.query<OldSettlement>(
    `SELECT id, group_id, from_user_id, to_user_id, amount_cents, status, created_at, confirmed_at
       FROM public.settlements
      ORDER BY id`,
  );
  const migrated: MigratedSettlement[] = [];
  const rows_ = rows.map((row) => {
    const settlementId = randomUUID();
    migrated.push({
      settlementId,
      groupId: row.group_id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      amountCents: row.amount_cents,
      status: row.status,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
    });
    return [
      settlementId,
      row.id,
      row.group_id,
      row.from_user_id,
      row.to_user_id,
      row.amount_cents,
      row.status,
      row.from_user_id,
      row.created_at,
      row.confirmed_at,
    ];
  });
  const count = await insertRows(
    newDb,
    "public.settlements",
    [
      { name: "id" },
      { name: "operation_id" },
      { name: "group_id" },
      { name: "from_user_id" },
      { name: "to_user_id" },
      { name: "amount_cents" },
      { name: "status" },
      { name: "created_by" },
      { name: "created_at" },
      { name: "confirmed_at" },
    ],
    rows_,
  );
  console.log(`  settlements: ${count}`);
  return { count, migrated };
}

async function migrateChatAndEvents(
  oldDb: Client,
  newDb: Client,
  migratedExpenses: MigratedExpense[],
  migratedSettlements: MigratedSettlement[],
): Promise<void> {
  const { rows: messages } = await oldDb.query<OldChatMessage>(
    `SELECT id, group_id, sender_id, content, created_at
       FROM public.chat_messages
      WHERE message_type = 'text'
      ORDER BY id`,
  );
  const messageCount = await insertRows(
    newDb,
    "public.chat_messages",
    [
      { name: "id" },
      { name: "client_id" },
      { name: "group_id" },
      { name: "sender_id" },
      { name: "content" },
      { name: "created_at" },
    ],
    messages.map((message) => [
      randomUUID(),
      message.id,
      message.group_id,
      message.sender_id,
      message.content,
      message.created_at,
    ]),
  );
  console.log(`  chat_messages: ${messageCount}`);

  const notifiedAt = new Date();
  const eventRows: unknown[][] = [];
  for (const expense of migratedExpenses) {
    eventRows.push([
      expense.groupId,
      expense.creatorId,
      "expense_created",
      expense.expenseId,
      null,
      null,
      { title: expense.title, totalCents: expense.totalCents },
      expense.createdAt,
      notifiedAt,
    ]);
  }
  for (const settlement of migratedSettlements) {
    if (settlement.status !== "confirmed") {
      continue;
    }
    if (settlement.confirmedAt === null && settlement.createdAt === null) {
      throw new Error(`settlement ${settlement.settlementId} has no timestamp for its confirmation event`);
    }
    eventRows.push([
      settlement.groupId,
      settlement.toUserId,
      "settlement_confirmed",
      null,
      settlement.settlementId,
      settlement.fromUserId,
      {
        amountCents: settlement.amountCents,
        fromUserId: settlement.fromUserId,
        toUserId: settlement.toUserId,
      },
      settlement.confirmedAt ?? settlement.createdAt,
      notifiedAt,
    ]);
  }
  const eventCount = await insertRows(
    newDb,
    "public.group_events",
    [
      { name: "group_id" },
      { name: "actor_id" },
      { name: "kind" },
      { name: "expense_id" },
      { name: "settlement_id" },
      { name: "subject_user_id" },
      { name: "payload" },
      { name: "created_at" },
      { name: "notified_at" },
    ],
    eventRows,
  );
  console.log(`  group_events: ${eventCount}`);
}

async function copyConversationReads(oldDb: Client, newDb: Client): Promise<number> {
  const { rows } = await oldDb.query<OldConversationRead>(
    "SELECT user_id, group_id, last_read_at FROM public.conversation_read_receipts",
  );
  return insertRows(
    newDb,
    "public.conversation_reads",
    [
      { name: "user_id" },
      { name: "group_id" },
      { name: "last_read_at" },
    ],
    rows.map((row) => [row.user_id, row.group_id, row.last_read_at]),
  );
}

async function recomputeBalances(newDb: Client): Promise<number> {
  const result = await newDb.query("SELECT public.recompute_group_balances(id) FROM public.groups ORDER BY id");
  return result.rows.length;
}

function compareNets(oldNet: Map<string, number>, newNet: Map<string, number>): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const [key, net] of oldNet) {
    if (newNet.get(key) !== net) {
      const [group_id, participant_id] = key.split("|");
      mismatches.push({ group_id, participant_id, old_net: net, new_net: newNet.get(key) ?? null });
    }
  }
  for (const [key, net] of newNet) {
    if (!oldNet.has(key)) {
      const [group_id, participant_id] = key.split("|");
      mismatches.push({ group_id, participant_id, old_net: null, new_net: net });
    }
  }
  return mismatches;
}

async function verifyUserBalances(oldDb: Client, newDb: Client): Promise<Mismatch[]> {
  const { rows: pairs } = await oldDb.query<OldBalance>(
    "SELECT group_id, user_a, user_b, amount_cents FROM public.balances",
  );
  const oldNet = new Map<string, number>();
  for (const pair of pairs) {
    const keyA = `${pair.group_id}|${pair.user_a}`;
    const keyB = `${pair.group_id}|${pair.user_b}`;
    oldNet.set(keyA, (oldNet.get(keyA) ?? 0) - pair.amount_cents);
    oldNet.set(keyB, (oldNet.get(keyB) ?? 0) + pair.amount_cents);
  }
  const { rows: guestCredits } = await oldDb.query<OldGuestCredit>(
    `SELECT e.group_id,
            c.user_id,
            SUM(ea.amount_cents)::text AS credit
       FROM public.expense_balance_allocations ea
       JOIN public.expense_allocation_entities d
         ON d.expense_id = ea.expense_id AND d.participant_index = ea.debtor_index
       JOIN public.expense_allocation_entities c
         ON c.expense_id = ea.expense_id AND c.participant_index = ea.creditor_index
       JOIN public.expenses e ON e.id = ea.expense_id
      WHERE ea.applied_to_user_id IS NULL
        AND d.entity_kind = 'guest'
        AND c.entity_kind = 'user'
      GROUP BY e.group_id, c.user_id`,
  );
  for (const credit of guestCredits) {
    const key = `${credit.group_id}|${credit.user_id}`;
    oldNet.set(key, (oldNet.get(key) ?? 0) + Number(credit.credit));
  }
  for (const [key, net] of oldNet) {
    if (net === 0) {
      oldNet.delete(key);
    }
  }
  const { rows: newRows } = await newDb.query<NewGroupBalance>(
    "SELECT group_id, participant_id, net_cents FROM public.group_balances WHERE kind = 'user'",
  );
  const newNet = new Map(
    newRows.map((row) => [`${row.group_id}|${row.participant_id}`, Number(row.net_cents)]),
  );
  return compareNets(oldNet, newNet);
}

async function verifyGuestBalances(oldDb: Client, newDb: Client): Promise<Mismatch[]> {
  const { rows: oldRows } = await oldDb.query<OldGuestPendingNet>(
    `SELECT e.group_id,
            ent.guest_id,
            SUM(CASE WHEN ea.debtor_index = ent.participant_index
                     THEN -ea.amount_cents ELSE ea.amount_cents END)::text AS net
       FROM public.expense_balance_allocations ea
       JOIN public.expense_allocation_entities ent
         ON ent.expense_id = ea.expense_id
        AND ent.participant_index IN (ea.debtor_index, ea.creditor_index)
       JOIN public.expenses e ON e.id = ea.expense_id
      WHERE ea.applied_to_user_id IS NULL
        AND ent.entity_kind = 'guest'
      GROUP BY e.group_id, ent.guest_id
      HAVING SUM(CASE WHEN ea.debtor_index = ent.participant_index
                      THEN -ea.amount_cents ELSE ea.amount_cents END) <> 0`,
  );
  const oldNet = new Map(
    oldRows.map((row) => [`${row.group_id}|${row.guest_id}`, Number(row.net)]),
  );
  const { rows: newRows } = await newDb.query<NewGroupBalance>(
    "SELECT group_id, participant_id, net_cents FROM public.group_balances WHERE kind = 'guest'",
  );
  const newNet = new Map(
    newRows.map((row) => [`${row.group_id}|${row.participant_id}`, Number(row.net_cents)]),
  );
  return compareNets(oldNet, newNet);
}

function printMismatches(label: string, mismatches: Mismatch[]): void {
  if (mismatches.length === 0) {
    console.log(`  ${label}: 0 mismatches`);
    return;
  }
  console.log(`  ${label}: ${mismatches.length} mismatches`);
  for (const mismatch of mismatches) {
    console.log(
      `    group ${mismatch.group_id} participant ${mismatch.participant_id}: ` +
        `old=${mismatch.old_net ?? "absent"} new=${mismatch.new_net ?? "absent"}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const oldDb = new Client({ connectionString: options.oldUrl });
  const newDb = new Client({ connectionString: options.newUrl });
  await oldDb.connect();
  await newDb.connect();
  try {
    await newDb.query("BEGIN");

    console.log("[1/7] copying users, groups, group_members, group_invite_links, push_subscriptions, vendor_charges");
    const users = await copyUsers(oldDb, newDb);
    const groups = await copyGroups(oldDb, newDb);
    const members = await copyGroupMembers(oldDb, newDb);
    const inviteLinks = await copyGroupInviteLinks(oldDb, newDb);
    const pushSubscriptions = await copyPushSubscriptions(oldDb, newDb);
    const vendorCharges = await copyVendorCharges(oldDb, newDb);
    console.log(`  users: ${users}`);
    console.log(`  groups: ${groups}`);
    console.log(`  group_members: ${members}`);
    console.log(`  group_invite_links: ${inviteLinks}`);
    console.log(`  push_subscriptions: ${pushSubscriptions}`);
    console.log(`  vendor_charges: ${vendorCharges}`);

    console.log("[2/7] migrating active and settled expenses");
    const { migrated: migratedExpenses, skippedDrafts } = await migrateExpenses(oldDb, newDb);
    console.log(`  skipped drafts: ${skippedDrafts}`);

    console.log("[3/7] migrating settlements");
    const { migrated: migratedSettlements } = await migrateSettlements(oldDb, newDb);

    console.log("[4/7] migrating chat messages and group events");
    await migrateChatAndEvents(oldDb, newDb, migratedExpenses, migratedSettlements);

    console.log("[5/7] copying conversation_read_receipts");
    const reads = await copyConversationReads(oldDb, newDb);
    console.log(`  conversation_reads: ${reads}`);

    console.log("[6/7] recomputing group balances");
    const recomputedGroups = await recomputeBalances(newDb);
    console.log(`  groups recomputed: ${recomputedGroups}`);

    console.log("[7/7] verifying balances");
    const userMismatches = await verifyUserBalances(oldDb, newDb);
    printMismatches("user balances", userMismatches);
    const guestMismatches = await verifyGuestBalances(oldDb, newDb);
    printMismatches("guest balances", guestMismatches);

    if (userMismatches.length > 0 || guestMismatches.length > 0) {
      process.exitCode = 1;
      await newDb.query("ROLLBACK");
      console.log("ROLLBACK (balance verification failed)");
      return;
    }

    if (options.dryRun) {
      await newDb.query("ROLLBACK");
      console.log("ROLLBACK (--dry-run)");
      return;
    }
    await newDb.query("COMMIT");
    console.log("COMMIT");
  } finally {
    await oldDb.end();
    await newDb.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
