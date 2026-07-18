import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type QueryResultRow } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createAndActivateExpense,
  createTestGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

type Subject = {
  client: Client;
  pid: number;
};

type QueryOutcome =
  | { rows: QueryResultRow[] }
  | { error: unknown };

type Snapshot = Record<string, string[]>;

type SnapshotQuery = {
  name: string;
  sql: string;
};

function batchSettlementSql(): string {
  return "SELECT * FROM public.record_settlements($1, $2::jsonb)";
}

function batchSettlementParameters(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): [string, string] {
  return [
    crypto.randomUUID(),
    JSON.stringify([{
      group_id: groupId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount_cents: amountCents,
    }]),
  ];
}

const snapshotQueries: SnapshotQuery[] = [
  {
    name: "groups",
    sql: "SELECT row_to_json(t)::text AS row FROM public.groups t WHERE t.id = $1 ORDER BY 1",
  },
  {
    name: "group_members",
    sql: "SELECT row_to_json(t)::text AS row FROM public.group_members t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "balances",
    sql: "SELECT row_to_json(t)::text AS row FROM public.balances t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "expenses",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expenses t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "expense_items",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expense_items t JOIN public.expenses e ON e.id = t.expense_id WHERE e.group_id = $1 ORDER BY 1",
  },
  {
    name: "expense_shares",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expense_shares t JOIN public.expenses e ON e.id = t.expense_id WHERE e.group_id = $1 ORDER BY 1",
  },
  {
    name: "expense_payers",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expense_payers t JOIN public.expenses e ON e.id = t.expense_id WHERE e.group_id = $1 ORDER BY 1",
  },
  {
    name: "expense_guests",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expense_guests t JOIN public.expenses e ON e.id = t.expense_id WHERE e.group_id = $1 ORDER BY 1",
  },
  {
    name: "expense_guest_shares",
    sql: "SELECT row_to_json(t)::text AS row FROM public.expense_guest_shares t JOIN public.expenses e ON e.id = t.expense_id WHERE e.group_id = $1 ORDER BY 1",
  },
  {
    name: "settlements",
    sql: "SELECT row_to_json(t)::text AS row FROM public.settlements t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "group_invite_links",
    sql: "SELECT row_to_json(t)::text AS row FROM public.group_invite_links t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "chat_messages",
    sql: "SELECT row_to_json(t)::text AS row FROM public.chat_messages t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "dm_pairs",
    sql: "SELECT row_to_json(t)::text AS row FROM public.dm_pairs t WHERE t.group_id = $1 ORDER BY 1",
  },
  {
    name: "conversation_read_receipts",
    sql: "SELECT row_to_json(t)::text AS row FROM public.conversation_read_receipts t WHERE t.group_id = $1 ORDER BY 1",
  },
];

function requireDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL is required for lock integration tests");
  }
  return databaseUrl;
}

function requireAdmin() {
  if (!adminClient) {
    throw new Error("Supabase integration environment is required");
  }
  return adminClient;
}

function requireMonitor(): Client {
  if (!monitorClient) {
    throw new Error("The PostgreSQL monitor is not connected");
  }
  return monitorClient;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const value = error.code;
  return typeof value === "string" ? value : undefined;
}

async function controlQuery<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await requireMonitor().query<T>(sql, values);
  return result.rows;
}

async function dispatchQuery(
  client: Client,
  sql: string,
  values: unknown[] = [],
): Promise<QueryOutcome> {
  try {
    const result = await client.query(sql, values);
    return { rows: result.rows };
  } catch (error: unknown) {
    return { error };
  }
}

function expectSqlError(outcome: QueryOutcome, code: string): void {
  if (!("error" in outcome)) {
    throw new Error(`Expected SQLSTATE ${code}, but the query succeeded`);
  }
  expect(errorCode(outcome.error)).toBe(code);
}

async function openSubject(
  user: TestUser | undefined,
  role: "authenticated" | "anon" | "service_role" = "authenticated",
): Promise<Subject> {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(user ? { role, sub: user.id } : { role }),
    ]);
    const result = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid()::integer AS pid",
    );
    return { client, pid: result.rows[0].pid };
  } catch (error: unknown) {
    await client.end();
    throw error;
  }
}

async function finishSubject(subject: Subject, commit: boolean): Promise<void> {
  try {
    await subject.client.query(commit ? "COMMIT" : "ROLLBACK");
  } finally {
    await subject.client.end();
  }
}

async function lockGroup(subject: Subject, groupId: string): Promise<void> {
  await subject.client.query(
    "SELECT id FROM public.groups WHERE id = $1 FOR UPDATE",
    [groupId],
  );
}

async function waitForLock(
  blockedPid: number,
  blockerPid: number,
  isDone: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await controlQuery<{
      wait_event_type: string | null;
      blocked_by: boolean;
    }>(
      "SELECT a.wait_event_type, $2 = ANY(pg_catalog.pg_blocking_pids(a.pid)) AS blocked_by FROM pg_catalog.pg_stat_activity a WHERE a.pid = $1",
      [blockedPid, blockerPid],
    );

    if (
      rows[0]?.wait_event_type === "Lock" &&
      rows[0].blocked_by === true
    ) {
      return;
    }

    if (isDone()) {
      throw new Error("Blocked statement completed before its lock wait was observed");
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("Timed out waiting for PostgreSQL lock observation");
}

async function snapshotGroup(groupId: string): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  for (const query of snapshotQueries) {
    const rows = await controlQuery<{ row: string }>(query.sql, [groupId]);
    snapshot[query.name] = rows.map((row) => row.row);
  }
  return snapshot;
}

async function createRegularGroup(
  creator: TestUser,
  members: TestUser[],
): Promise<string> {
  const group = await createTestGroupWithMembers(creator, members);
  return group.id;
}

async function insertDraftExpense(
  groupId: string,
  creator: TestUser,
  totalAmount = 1000,
): Promise<string> {
  const client = requireAdmin();
  const { data, error } = await client
    .from("expenses")
    .insert({
      group_id: groupId,
      creator_id: creator.id,
      title: "Protected draft",
      expense_type: "single_amount",
      total_amount: totalAmount,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert draft expense: ${error?.message}`);
  }
  return data.id;
}

async function insertExpenseChildren(
  expenseId: string,
  creator: TestUser,
  member: TestUser,
  totalAmount = 1000,
): Promise<void> {
  const client = requireAdmin();
  const { error: sharesError } = await client.from("expense_shares").insert([
    {
      expense_id: expenseId,
      user_id: creator.id,
      share_amount_cents: totalAmount / 2,
    },
    {
      expense_id: expenseId,
      user_id: member.id,
      share_amount_cents: totalAmount / 2,
    },
  ]);
  if (sharesError) {
    throw new Error(`Failed to insert expense shares: ${sharesError.message}`);
  }

  const { error: payerError } = await client.from("expense_payers").insert({
    expense_id: expenseId,
    user_id: creator.id,
    amount_cents: totalAmount,
  });
  if (payerError) {
    throw new Error(`Failed to insert expense payer: ${payerError.message}`);
  }
}

async function insertGuestExpenseChildren(
  expenseId: string,
  creator: TestUser,
  member: TestUser,
): Promise<void> {
  const client = requireAdmin();
  const { error: sharesError } = await client.from("expense_shares").insert([
    {
      expense_id: expenseId,
      user_id: creator.id,
      share_amount_cents: 400,
    },
    {
      expense_id: expenseId,
      user_id: member.id,
      share_amount_cents: 400,
    },
  ]);
  if (sharesError) {
    throw new Error(`Failed to insert guest expense shares: ${sharesError.message}`);
  }

  const { error: payerError } = await client.from("expense_payers").insert({
    expense_id: expenseId,
    user_id: creator.id,
    amount_cents: 1000,
  });
  if (payerError) {
    throw new Error(`Failed to insert guest expense payer: ${payerError.message}`);
  }
}

async function insertPendingSettlement(
  groupId: string,
  from: TestUser,
  to: TestUser,
  amountCents = 100,
): Promise<string> {
  const { data, error } = await requireAdmin()
    .from("settlements")
    .insert({
      group_id: groupId,
      from_user_id: from.id,
      to_user_id: to.id,
      amount_cents: amountCents,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert pending settlement: ${error?.message}`);
  }
  return data.id;
}

async function insertConfirmedSettlement(
  groupId: string,
  from: TestUser,
  to: TestUser,
  amountCents = 100,
): Promise<string> {
  const { data, error } = await requireAdmin()
    .from("settlements")
    .insert({
      group_id: groupId,
      from_user_id: from.id,
      to_user_id: to.id,
      amount_cents: amountCents,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert confirmed settlement: ${error?.message}`);
  }
  return data.id;
}

async function insertBalance(
  groupId: string,
  first: TestUser,
  second: TestUser,
  amountCents: number,
): Promise<void> {
  const [userA, userB] = first.id < second.id ? [first, second] : [second, first];
  const { error } = await requireAdmin().from("balances").insert({
    group_id: groupId,
    user_a: userA.id,
    user_b: userB.id,
    amount_cents: amountCents,
  });
  if (error) {
    throw new Error(`Failed to insert balance: ${error.message}`);
  }
}

async function insertZeroBalance(
  groupId: string,
  first: TestUser,
  second: TestUser,
): Promise<void> {
  await insertBalance(groupId, first, second, 0);
}

async function insertGroupOwnedRows(
  groupId: string,
  creator: TestUser,
  member: TestUser,
): Promise<void> {
  const client = requireAdmin();
  const { error: linkError } = await client.from("group_invite_links").insert({
    group_id: groupId,
    created_by: creator.id,
  });
  if (linkError) {
    throw new Error(`Failed to insert invite link: ${linkError.message}`);
  }

  const { error: messageError } = await client.from("chat_messages").insert({
    group_id: groupId,
    sender_id: creator.id,
    message_type: "text",
    content: "protected group message",
  });
  if (messageError) {
    throw new Error(`Failed to insert chat message: ${messageError.message}`);
  }

  const { error: receiptError } = await client
    .from("conversation_read_receipts")
    .insert({ group_id: groupId, user_id: member.id });
  if (receiptError) {
    throw new Error(`Failed to insert read receipt: ${receiptError.message}`);
  }
}

async function createDmGroup(creator: TestUser, member: TestUser): Promise<string> {
  const { data, error } = await requireAdmin()
    .from("groups")
    .insert({ name: "", creator_id: creator.id, is_dm: true })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert DM group: ${error?.message}`);
  }
  const { error: memberError } = await requireAdmin().from("group_members").insert([
    {
      group_id: data.id,
      user_id: creator.id,
      status: "accepted",
      invited_by: creator.id,
      accepted_at: new Date().toISOString(),
    },
    {
      group_id: data.id,
      user_id: member.id,
      status: "accepted",
      invited_by: creator.id,
      accepted_at: new Date().toISOString(),
    },
  ]);
  if (memberError) {
    throw new Error(`Failed to insert DM members: ${memberError.message}`);
  }
  return data.id;
}

let monitorClient: Client | undefined;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

describe.skipIf(!canRun)("group deletion financial boundary", () => {
  beforeAll(async () => {
    [alice, bob, carol] = await createTestUsers(3, {
      name: "Group deletion",
    });
    monitorClient = new Client({ connectionString: requireDatabaseUrl() });
    await monitorClient.connect();
  });

  afterAll(async () => {
    if (monitorClient) {
      await monitorClient.end();
      monitorClient = undefined;
    }
  });

  it("deletes an empty regular group and cascades derived zero balances", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    await insertZeroBalance(groupId, alice, bob);
    await insertGroupOwnedRows(groupId, alice, bob);

    const subject = await openSubject(alice);
    const outcome = await dispatchQuery(subject.client, "SELECT public.delete_group($1)", [
      groupId,
    ]);
    expect("error" in outcome).toBe(false);
    await finishSubject(subject, true);

    const snapshot = await snapshotGroup(groupId);
    for (const rows of Object.values(snapshot)) {
      expect(rows).toEqual([]);
    }
  });

  it("removes authenticated direct group deletion and limits the RPC privilege boundary", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const before = await snapshotGroup(groupId);

    const creatorDelete = await openSubject(alice);
    expectSqlError(
      await dispatchQuery(
        creatorDelete.client,
        "DELETE FROM public.groups WHERE id = $1",
        [groupId],
      ),
      "42501",
    );
    await finishSubject(creatorDelete, false);

    const anonDelete = await openSubject(undefined, "anon");
    expectSqlError(
      await dispatchQuery(
        anonDelete.client,
        "DELETE FROM public.groups WHERE id = $1",
        [groupId],
      ),
      "42501",
    );
    await finishSubject(anonDelete, false);

    const nonCreator = await openSubject(bob);
    expectSqlError(
      await dispatchQuery(nonCreator.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST05",
    );
    await finishSubject(nonCreator, false);

    const privilegeRows = await controlQuery<{
      anon_delete: boolean;
      authenticated_delete: boolean;
      service_delete: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
    }>(
      "SELECT has_table_privilege('anon', 'public.groups', 'DELETE') AS anon_delete, has_table_privilege('authenticated', 'public.groups', 'DELETE') AS authenticated_delete, has_table_privilege('service_role', 'public.groups', 'DELETE') AS service_delete, has_function_privilege('anon', 'public.delete_group(uuid)', 'EXECUTE') AS anon_execute, has_function_privilege('authenticated', 'public.delete_group(uuid)', 'EXECUTE') AS authenticated_execute, has_function_privilege('service_role', 'public.delete_group(uuid)', 'EXECUTE') AS service_execute",
    );
    expect(privilegeRows[0]).toEqual({
      anon_delete: false,
      authenticated_delete: false,
      service_delete: true,
      anon_execute: false,
      authenticated_execute: true,
      service_execute: false,
    });
    await expect(snapshotGroup(groupId)).resolves.toEqual(before);
  });

  it("uses stable authentication, authorization, and lifecycle SQLSTATEs", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const dmGroupId = await createDmGroup(alice, bob);
    const missingGroupId = "00000000-0000-0000-0000-000000000000";

    const noClaims = await openSubject(undefined);
    expectSqlError(
      await dispatchQuery(noClaims.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST01",
    );
    await finishSubject(noClaims, false);

    const missing = await openSubject(alice);
    expectSqlError(
      await dispatchQuery(missing.client, "SELECT public.delete_group($1)", [
        missingGroupId,
      ]),
      "PST05",
    );
    await finishSubject(missing, false);

    const nonCreator = await openSubject(bob);
    expectSqlError(
      await dispatchQuery(nonCreator.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST05",
    );
    await finishSubject(nonCreator, false);

    const dmCreator = await openSubject(alice);
    expectSqlError(
      await dispatchQuery(dmCreator.client, "SELECT public.delete_group($1)", [
        dmGroupId,
      ]),
      "PST05",
    );
    await finishSubject(dmCreator, false);
  });

  it("denies every protected financial state without changing group rows", async () => {
    const draftGroup = await createRegularGroup(alice, [bob]);
    const draftExpenseId = await insertDraftExpense(draftGroup, alice);
    await insertExpenseChildren(draftExpenseId, alice, bob);

    const activeGroup = await createRegularGroup(alice, [bob]);
    await createAndActivateExpense({
      creator: alice,
      groupId: activeGroup,
      shares: [
        { userId: alice.id, amount: 500 },
        { userId: bob.id, amount: 500 },
      ],
      payers: [{ userId: alice.id, amount: 1000 }],
      title: "Protected active",
    });

    const settledGroup = await createRegularGroup(alice, [bob]);
    const settledExpenseId = await insertDraftExpense(settledGroup, alice);
    const { error: settledError } = await requireAdmin()
      .from("expenses")
      .update({ status: "settled" })
      .eq("id", settledExpenseId);
    if (settledError) throw new Error(settledError.message);

    const pendingGroup = await createRegularGroup(alice, [bob]);
    await insertPendingSettlement(pendingGroup, bob, alice);

    const confirmedGroup = await createRegularGroup(alice, [bob]);
    await insertConfirmedSettlement(confirmedGroup, bob, alice);
    await insertZeroBalance(confirmedGroup, alice, bob);

    const balanceOnlyGroup = await createRegularGroup(alice, [bob]);
    await insertBalance(balanceOnlyGroup, alice, bob, 500);

    for (const protectedGroupId of [
      draftGroup,
      activeGroup,
      settledGroup,
      pendingGroup,
      confirmedGroup,
      balanceOnlyGroup,
    ]) {
      const before = await snapshotGroup(protectedGroupId);
      const subject = await openSubject(alice);
      expectSqlError(
        await dispatchQuery(subject.client, "SELECT public.delete_group($1)", [
          protectedGroupId,
        ]),
        "PST08",
      );
      await finishSubject(subject, false);
      await expect(snapshotGroup(protectedGroupId)).resolves.toEqual(before);
    }
  });

  it("preserves the draft-only expense delete boundary", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const draftExpenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(draftExpenseId, alice, bob);

    const creatorClient = authenticateAs(alice);
    const { data: deletedDraft, error: draftDeleteError } = await creatorClient
      .from("expenses")
      .delete()
      .eq("id", draftExpenseId)
      .select("id");
    if (draftDeleteError) throw new Error(draftDeleteError.message);
    expect(deletedDraft).toHaveLength(1);

    const activeExpenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(activeExpenseId, alice, bob);
    const { error: activationError } = await creatorClient.rpc("activate_expense", {
      p_expense_id: activeExpenseId,
    });
    if (activationError) throw new Error(activationError.message);

    const { data: deletedActive, error: activeDeleteError } = await creatorClient
      .from("expenses")
      .delete()
      .eq("id", activeExpenseId)
      .select("id");
    if (activeDeleteError) throw new Error(activeDeleteError.message);
    expect(deletedActive).toEqual([]);

    const { data: activeRow, error: activeReadError } = await requireAdmin()
      .from("expenses")
      .select("id, status")
      .eq("id", activeExpenseId)
      .single();
    if (activeReadError) throw new Error(activeReadError.message);
    expect(activeRow.status).toBe("active");

    const settledExpenseId = await insertDraftExpense(groupId, alice);
    const { error: settledError } = await requireAdmin()
      .from("expenses")
      .update({ status: "settled" })
      .eq("id", settledExpenseId);
    if (settledError) throw new Error(settledError.message);
    const { data: deletedSettled, error: settledDeleteError } = await creatorClient
      .from("expenses")
      .delete()
      .eq("id", settledExpenseId)
      .select("id");
    if (settledDeleteError) throw new Error(settledDeleteError.message);
    expect(deletedSettled).toEqual([]);

    const wrongOwnerExpenseId = await insertDraftExpense(groupId, alice);
    const { data: deletedByWrongOwner, error: wrongOwnerDeleteError } =
      await authenticateAs(bob)
        .from("expenses")
        .delete()
        .eq("id", wrongOwnerExpenseId)
        .select("id");
    if (wrongOwnerDeleteError) throw new Error(wrongOwnerDeleteError.message);
    expect(deletedByWrongOwner).toEqual([]);
  });

  it("serializes writer-first batch settlement before deletion", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const writer = await openSubject(bob);
    const writerResult = await dispatchQuery(
      writer.client,
      batchSettlementSql(),
      batchSettlementParameters(groupId, bob.id, alice.id, 200),
    );
    expect("error" in writerResult).toBe(false);

    const deletion = await openSubject(alice);
    let deletionDone = false;
    const deletionPromise = dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    ).finally(() => {
      deletionDone = true;
    });
    await waitForLock(deletion.pid, writer.pid, () => deletionDone);
    await finishSubject(writer, true);
    const deletionResult = await deletionPromise;
    expectSqlError(deletionResult, "PST08");
    await finishSubject(deletion, false);

    const rows = await controlQuery<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.settlements WHERE group_id = $1",
      [groupId],
    );
    expect(rows[0].count).toBe("1");
  });

  it("serializes writer-first activation before deletion", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(expenseId, alice, bob);

    const writer = await openSubject(alice);
    const activationResult = await dispatchQuery(
      writer.client,
      "SELECT public.activate_expense($1)",
      [expenseId],
    );
    expect("error" in activationResult).toBe(false);

    const deletion = await openSubject(alice);
    let deletionDone = false;
    const deletionPromise = dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    ).finally(() => {
      deletionDone = true;
    });
    await waitForLock(deletion.pid, writer.pid, () => deletionDone);
    await finishSubject(writer, true);
    expectSqlError(await deletionPromise, "PST08");
    await finishSubject(deletion, false);
  });

  it("serializes writer-first settlement confirmation before deletion", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const settlementId = await insertPendingSettlement(groupId, bob, alice, 200);

    const writer = await openSubject(alice);
    const confirmationResult = await dispatchQuery(
      writer.client,
      "SELECT public.confirm_settlement($1)",
      [settlementId],
    );
    expect("error" in confirmationResult).toBe(false);

    const deletion = await openSubject(alice);
    let deletionDone = false;
    const deletionPromise = dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    ).finally(() => {
      deletionDone = true;
    });
    await waitForLock(deletion.pid, writer.pid, () => deletionDone);
    await finishSubject(writer, true);
    expectSqlError(await deletionPromise, "PST08");
    await finishSubject(deletion, false);
  });

  it("serializes writer-first active guest claims before deletion", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice, 1000);
    await insertGuestExpenseChildren(expenseId, alice, bob);
    const { data: guest, error: guestError } = await requireAdmin()
      .from("expense_guests")
      .insert({ expense_id: expenseId, display_name: "Guest" })
      .select("id, claim_token")
      .single();
    if (guestError || !guest) throw new Error(guestError?.message);
    const { error: guestShareError } = await requireAdmin()
      .from("expense_guest_shares")
      .insert({ expense_id: expenseId, guest_id: guest.id, share_amount_cents: 200 });
    if (guestShareError) throw new Error(guestShareError.message);
    const { error: activateError } = await authenticateAs(alice).rpc(
      "activate_expense",
      { p_expense_id: expenseId },
    );
    if (activateError) throw new Error(activateError.message);

    const writer = await openSubject(carol);
    const claimResult = await dispatchQuery(
      writer.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claim_token],
    );
    expect("error" in claimResult).toBe(false);

    const deletion = await openSubject(alice);
    let deletionDone = false;
    const deletionPromise = dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    ).finally(() => {
      deletionDone = true;
    });
    await waitForLock(deletion.pid, writer.pid, () => deletionDone);
    await finishSubject(writer, true);
    expectSqlError(await deletionPromise, "PST08");
    await finishSubject(deletion, false);
  });

  it("serializes group-first invite joins and deletion in both orders", async () => {
    const joinFirstGroup = await createRegularGroup(alice, [bob]);
    const { data: joinFirstLink, error: joinFirstLinkError } = await requireAdmin()
      .from("group_invite_links")
      .insert({ group_id: joinFirstGroup, created_by: alice.id })
      .select("token")
      .single();
    if (joinFirstLinkError || !joinFirstLink) {
      throw new Error(joinFirstLinkError?.message);
    }

    const joiner = await openSubject(carol);
    const joinResult = await dispatchQuery(
      joiner.client,
      "SELECT public.join_group_via_link($1)",
      [joinFirstLink.token],
    );
    expect("error" in joinResult).toBe(false);

    const deletion = await openSubject(alice);
    let deletionDone = false;
    const deletionPromise = dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [joinFirstGroup],
    ).finally(() => {
      deletionDone = true;
    });
    await waitForLock(deletion.pid, joiner.pid, () => deletionDone);
    await finishSubject(joiner, true);
    const successfulDelete = await deletionPromise;
    expect("error" in successfulDelete).toBe(false);
    await finishSubject(deletion, true);
    expect(
      await controlQuery<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.groups WHERE id = $1",
        [joinFirstGroup],
      ),
    ).toEqual([{ count: "0" }]);

    const deleteFirstGroup = await createRegularGroup(alice, [bob]);
    const { data: deleteFirstLink, error: deleteFirstLinkError } = await requireAdmin()
      .from("group_invite_links")
      .insert({ group_id: deleteFirstGroup, created_by: alice.id })
      .select("token")
      .single();
    if (deleteFirstLinkError || !deleteFirstLink) {
      throw new Error(deleteFirstLinkError?.message);
    }

    const deletionFirst = await openSubject(alice);
    await lockGroup(deletionFirst, deleteFirstGroup);
    const deleteResult = await dispatchQuery(
      deletionFirst.client,
      "SELECT public.delete_group($1)",
      [deleteFirstGroup],
    );
    expect("error" in deleteResult).toBe(false);

    const blockedJoin = await openSubject(carol);
    let joinDone = false;
    const blockedJoinPromise = dispatchQuery(
      blockedJoin.client,
      "SELECT public.join_group_via_link($1)",
      [deleteFirstLink.token],
    ).finally(() => {
      joinDone = true;
    });
    await waitForLock(blockedJoin.pid, deletionFirst.pid, () => joinDone);
    await finishSubject(deletionFirst, true);
    expectSqlError(await blockedJoinPromise, "PST08");
    await finishSubject(blockedJoin, false);
  });

  it("uses group then expense then guest ordering against draft deletion", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice, 1000);
    await insertExpenseChildren(expenseId, alice, bob, 1000);
    const { data: guest, error: guestError } = await requireAdmin()
      .from("expense_guests")
      .insert({ expense_id: expenseId, display_name: "Guest" })
      .select("id, claim_token")
      .single();
    if (guestError || !guest) throw new Error(guestError?.message);

    const draftDelete = await openSubject(alice);
    await draftDelete.client.query(
      "SELECT id FROM public.expenses WHERE id = $1 FOR UPDATE",
      [expenseId],
    );
    const draftDeleteResult = await dispatchQuery(
      draftDelete.client,
      "DELETE FROM public.expenses WHERE id = $1",
      [expenseId],
    );
    expect("error" in draftDeleteResult).toBe(false);

    const claim = await openSubject(carol);
    let claimDone = false;
    const claimPromise = dispatchQuery(
      claim.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claim_token],
    ).finally(() => {
      claimDone = true;
    });
    await waitForLock(claim.pid, draftDelete.pid, () => claimDone);
    await finishSubject(draftDelete, true);
    const claimResult = await claimPromise;
    expect("error" in claimResult).toBe(true);
    await finishSubject(claim, false);
  });

  it("serializes real foreign-key expense and settlement inserts", async () => {
    const expenseFirstGroup = await createRegularGroup(alice, [bob]);
    const expenseInsert = await openSubject(alice);
    const expenseInsertResult = await dispatchQuery(
      expenseInsert.client,
      "INSERT INTO public.expenses (group_id, creator_id, title, expense_type, total_amount, status) VALUES ($1, $2, 'FK race expense', 'single_amount', 1, 'draft') RETURNING id",
      [expenseFirstGroup, alice.id],
    );
    expect("error" in expenseInsertResult).toBe(false);

    const expenseDelete = await openSubject(alice);
    let expenseDeleteDone = false;
    const expenseDeletePromise = dispatchQuery(
      expenseDelete.client,
      "SELECT public.delete_group($1)",
      [expenseFirstGroup],
    ).finally(() => {
      expenseDeleteDone = true;
    });
    await waitForLock(expenseDelete.pid, expenseInsert.pid, () => expenseDeleteDone);
    await finishSubject(expenseInsert, true);
    expectSqlError(await expenseDeletePromise, "PST08");
    await finishSubject(expenseDelete, false);

    const settlementFirstGroup = await createRegularGroup(alice, [bob]);
    const settlementInsert = await openSubject(bob);
    const settlementInsertResult = await dispatchQuery(
      settlementInsert.client,
      "INSERT INTO public.settlements (group_id, from_user_id, to_user_id, amount_cents, status) VALUES ($1, $2, $3, 1, 'pending') RETURNING id",
      [settlementFirstGroup, bob.id, alice.id],
    );
    expect("error" in settlementInsertResult).toBe(false);

    const settlementDelete = await openSubject(alice);
    let settlementDeleteDone = false;
    const settlementDeletePromise = dispatchQuery(
      settlementDelete.client,
      "SELECT public.delete_group($1)",
      [settlementFirstGroup],
    ).finally(() => {
      settlementDeleteDone = true;
    });
    await waitForLock(
      settlementDelete.pid,
      settlementInsert.pid,
      () => settlementDeleteDone,
    );
    await finishSubject(settlementInsert, true);
    expectSqlError(await settlementDeletePromise, "PST08");
    await finishSubject(settlementDelete, false);
  });
  it("deletes first and rejects a later batch settlement call", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const deletion = await openSubject(alice);
    await lockGroup(deletion, groupId);
    const deletionResult = await dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    );
    expect("error" in deletionResult).toBe(false);
    await finishSubject(deletion, true);

    const writer = await openSubject(bob);
    expectSqlError(
      await dispatchQuery(
        writer.client,
        batchSettlementSql(),
        batchSettlementParameters(groupId, bob.id, alice.id, 200),
      ),
      "PST08",
    );
    await finishSubject(writer, false);
  });

  it("rejects deletion first and then lets activation commit", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(expenseId, alice, bob);

    const deletion = await openSubject(alice);
    await lockGroup(deletion, groupId);
    expectSqlError(
      await dispatchQuery(deletion.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST08",
    );
    await finishSubject(deletion, false);

    const writer = await openSubject(alice);
    const activationResult = await dispatchQuery(
      writer.client,
      "SELECT public.activate_expense($1)",
      [expenseId],
    );
    expect("error" in activationResult).toBe(false);
    await finishSubject(writer, true);
  });


  it("rejects deletion first and then lets settlement confirmation commit", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const settlementId = await insertPendingSettlement(groupId, bob, alice, 200);

    const deletion = await openSubject(alice);
    await lockGroup(deletion, groupId);
    expectSqlError(
      await dispatchQuery(deletion.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST08",
    );
    await finishSubject(deletion, false);

    const writer = await openSubject(alice);
    const confirmationResult = await dispatchQuery(
      writer.client,
      "SELECT public.confirm_settlement($1)",
      [settlementId],
    );
    expect("error" in confirmationResult).toBe(false);
    await finishSubject(writer, true);
  });

  it("rejects deletion first and then lets an active guest claim commit", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice, 1000);
    await insertGuestExpenseChildren(expenseId, alice, bob);
    const { data: guest, error: guestError } = await requireAdmin()
      .from("expense_guests")
      .insert({ expense_id: expenseId, display_name: "Guest" })
      .select("id, claim_token")
      .single();
    if (guestError || !guest) throw new Error(guestError?.message);
    const { error: guestShareError } = await requireAdmin()
      .from("expense_guest_shares")
      .insert({ expense_id: expenseId, guest_id: guest.id, share_amount_cents: 200 });
    if (guestShareError) throw new Error(guestShareError.message);
    const { error: activateError } = await authenticateAs(alice).rpc(
      "activate_expense",
      { p_expense_id: expenseId },
    );
    if (activateError) throw new Error(activateError.message);

    const deletion = await openSubject(alice);
    await lockGroup(deletion, groupId);
    expectSqlError(
      await dispatchQuery(deletion.client, "SELECT public.delete_group($1)", [
        groupId,
      ]),
      "PST08",
    );
    await finishSubject(deletion, false);

    const writer = await openSubject(carol);
    const claimResult = await dispatchQuery(
      writer.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claim_token],
    );
    expect("error" in claimResult).toBe(false);
    await finishSubject(writer, true);
  });

  it("allows a successful deletion before a later batch settlement call", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const deletion = await openSubject(alice);
    const deletionResult = await dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [groupId],
    );
    expect("error" in deletionResult).toBe(false);
    await finishSubject(deletion, true);

    const writer = await openSubject(bob);
    expectSqlError(
      await dispatchQuery(
        writer.client,
        batchSettlementSql(),
        batchSettlementParameters(groupId, bob.id, alice.id, 200),
      ),
      "PST08",
    );
    await finishSubject(writer, false);
  });

  it("keeps claim-first and draft-delete-first transactions deadlock-free", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice, 1000);
    await insertGuestExpenseChildren(expenseId, alice, bob);
    const { data: guest, error: guestError } = await requireAdmin()
      .from("expense_guests")
      .insert({ expense_id: expenseId, display_name: "Guest" })
      .select("id, claim_token")
      .single();
    if (guestError || !guest) throw new Error(guestError?.message);
    const { error: guestShareError } = await requireAdmin()
      .from("expense_guest_shares")
      .insert({ expense_id: expenseId, guest_id: guest.id, share_amount_cents: 200 });
    if (guestShareError) throw new Error(guestShareError.message);

    const claim = await openSubject(carol);
    const claimResult = await dispatchQuery(
      claim.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claim_token],
    );
    expect("error" in claimResult).toBe(false);

    const draftDelete = await openSubject(alice);
    let draftDeleteDone = false;
    const draftDeletePromise = dispatchQuery(
      draftDelete.client,
      "DELETE FROM public.expenses WHERE id = $1",
      [expenseId],
    ).finally(() => {
      draftDeleteDone = true;
    });
    await waitForLock(draftDelete.pid, claim.pid, () => draftDeleteDone);
    await finishSubject(claim, true);
    const draftDeleteResult = await draftDeletePromise;
    expect("error" in draftDeleteResult).toBe(false);
    await finishSubject(draftDelete, true);
  });

  it("keeps service-role teardown independent from the authenticated RPC", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(expenseId, alice, bob);
    const teardown = await openSubject(undefined, "service_role");
    const teardownResult = await dispatchQuery(
      teardown.client,
      "DELETE FROM public.groups WHERE id = $1",
      [groupId],
    );
    expect("error" in teardownResult).toBe(false);
    await finishSubject(teardown, true);
    expect(
      await controlQuery<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.groups WHERE id = $1",
        [groupId],
      ),
    ).toEqual([{ count: "0" }]);
  });
  it("rejects direct expense and settlement inserts after delete-first commit", async () => {
    const expenseGroup = await createRegularGroup(alice, [bob]);
    const deletion = await openSubject(alice);
    await lockGroup(deletion, expenseGroup);
    const deletionResult = await dispatchQuery(
      deletion.client,
      "SELECT public.delete_group($1)",
      [expenseGroup],
    );
    expect("error" in deletionResult).toBe(false);

    const expenseInsert = await openSubject(alice);
    let expenseInsertDone = false;
    const expenseInsertPromise = dispatchQuery(
      expenseInsert.client,
      "INSERT INTO public.expenses (group_id, creator_id, title, expense_type, total_amount, status) VALUES ($1, $2, 'FK delete-first expense', 'single_amount', 1, 'draft') RETURNING id",
      [expenseGroup, alice.id],
    ).finally(() => {
      expenseInsertDone = true;
    });
    await waitForLock(expenseInsert.pid, deletion.pid, () => expenseInsertDone);
    await finishSubject(deletion, true);
    expectSqlError(await expenseInsertPromise, "23503");
    await finishSubject(expenseInsert, false);

    const settlementGroup = await createRegularGroup(alice, [bob]);
    const settlementDeletion = await openSubject(alice);
    await lockGroup(settlementDeletion, settlementGroup);
    const settlementDeletionResult = await dispatchQuery(
      settlementDeletion.client,
      "SELECT public.delete_group($1)",
      [settlementGroup],
    );
    expect("error" in settlementDeletionResult).toBe(false);

    const settlementInsert = await openSubject(bob);
    let settlementInsertDone = false;
    const settlementInsertPromise = dispatchQuery(
      settlementInsert.client,
      "INSERT INTO public.settlements (group_id, from_user_id, to_user_id, amount_cents, status) VALUES ($1, $2, $3, 1, 'pending') RETURNING id",
      [settlementGroup, bob.id, alice.id],
    ).finally(() => {
      settlementInsertDone = true;
    });
    await waitForLock(
      settlementInsert.pid,
      settlementDeletion.pid,
      () => settlementInsertDone,
    );
    await finishSubject(settlementDeletion, true);
    expectSqlError(await settlementInsertPromise, "23503");
    await finishSubject(settlementInsert, false);
  });

  it("keeps concurrent DM creation canonical without leaked candidates", async () => {
    const first = await openSubject(alice);
    const second = await openSubject(bob);
    const firstPromise = dispatchQuery(
      first.client,
      "SELECT public.get_or_create_dm_group($1)",
      [bob.id],
    );
    const secondPromise = dispatchQuery(
      second.client,
      "SELECT public.get_or_create_dm_group($1)",
      [alice.id],
    );
    const firstWinner = await Promise.race([
      firstPromise.then(() => "first" as const),
      secondPromise.then(() => "second" as const),
    ]);
    if (firstWinner === "first") {
      const firstResult = await firstPromise;
      expect("error" in firstResult).toBe(false);
      await finishSubject(first, true);
      const secondResult = await secondPromise;
      expect("error" in secondResult).toBe(false);
      await finishSubject(second, true);
    } else {
      const secondResult = await secondPromise;
      expect("error" in secondResult).toBe(false);
      await finishSubject(second, true);
      const firstResult = await firstPromise;
      expect("error" in firstResult).toBe(false);
      await finishSubject(first, true);
    }

    const pairRows = await controlQuery<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.dm_pairs WHERE user_a = LEAST($1::uuid, $2::uuid) AND user_b = GREATEST($1::uuid, $2::uuid)",
      [alice.id, bob.id],
    );
    expect(pairRows).toEqual([{ count: "1" }]);
    const groupRows = await controlQuery<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.groups g JOIN public.dm_pairs p ON p.group_id = g.id WHERE p.user_a = LEAST($1::uuid, $2::uuid) AND p.user_b = GREATEST($1::uuid, $2::uuid)",
      [alice.id, bob.id],
    );
    expect(groupRows).toEqual([{ count: "1" }]);
    const memberRows = await controlQuery<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.group_members gm JOIN public.dm_pairs p ON p.group_id = gm.group_id WHERE p.user_a = LEAST($1::uuid, $2::uuid) AND p.user_b = GREATEST($1::uuid, $2::uuid)",
      [alice.id, bob.id],
    );
    expect(memberRows).toEqual([{ count: "2" }]);
  });
  it("returns a void success through the authenticated RPC client", async () => {
    const groupId = await createRegularGroup(alice, [bob]);
    const { data, error } = await authenticateAs(alice).rpc("delete_group", {
      p_group_id: groupId,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
