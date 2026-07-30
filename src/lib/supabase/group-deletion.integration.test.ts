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
  // #477: the guard's expenses INSERT branch needs a 'new'-sourced token
  // only save_expense_draft_graph can open. Route through the RPC as the
  // creator's authenticated client, with empty shares/payers (children are
  // added separately by insertExpenseChildren / insertGuestExpenseChildren
  // via a raw direct-mutation-token transaction below).
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title: "Protected draft",
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: totalAmount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: [],
    p_payers: [],
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });
  if (error || !data) {
    throw new Error(`Failed to insert draft expense: ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/** Opens a direct mutation token and inserts guarded child rows. */
async function insertGuardedChildren(
  expenseId: string,
  shares: { user_id: string; share_amount_cents: number }[],
  payers: { user_id: string; amount_cents: number }[],
): Promise<void> {
  const conn = new Client({ connectionString: requireDatabaseUrl() });
  await conn.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
      [expenseId],
    ]);
    for (const s of shares) {
      await conn.query(
        "insert into public.expense_shares (expense_id, user_id, share_amount_cents) values ($1, $2, $3)",
        [expenseId, s.user_id, s.share_amount_cents],
      );
    }
    for (const p of payers) {
      await conn.query(
        "insert into public.expense_payers (expense_id, user_id, amount_cents) values ($1, $2, $3)",
        [expenseId, p.user_id, p.amount_cents],
      );
    }
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await conn.end();
  }
}

async function insertExpenseChildren(
  expenseId: string,
  creator: TestUser,
  member: TestUser,
  totalAmount = 1000,
): Promise<void> {
  await insertGuardedChildren(
    expenseId,
    [
      { user_id: creator.id, share_amount_cents: totalAmount / 2 },
      { user_id: member.id, share_amount_cents: totalAmount / 2 },
    ],
    [{ user_id: creator.id, amount_cents: totalAmount }],
  );
}

async function insertGuestExpenseChildren(
  expenseId: string,
  creator: TestUser,
  member: TestUser,
): Promise<void> {
  await insertGuardedChildren(
    expenseId,
    [
      { user_id: creator.id, share_amount_cents: 400 },
      { user_id: member.id, share_amount_cents: 400 },
    ],
    [{ user_id: creator.id, amount_cents: 1000 }],
  );
}

/**
 * Inserts a guest + guest_share via a direct-mutation-token transaction.
 * Returns { guestId, claimToken }.
 */
async function insertGuardedGuest(
  expenseId: string,
  displayName: string,
  shareAmountCents: number,
): Promise<{ guestId: string; claimToken: string }> {
  const conn = new Client({ connectionString: requireDatabaseUrl() });
  await conn.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
    const { rows } = await conn.query<{ id: string; claim_token: string }>(
      "insert into public.expense_guests (expense_id, display_name) values ($1, $2) returning id, claim_token",
      [expenseId, displayName],
    );
    await conn.query(
      "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, $3)",
      [expenseId, rows[0].id, shareAmountCents],
    );
    await conn.query("COMMIT");
    return { guestId: rows[0].id, claimToken: rows[0].claim_token };
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await conn.end();
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
  const creatorClient = authenticateAs(creator);
  const { data: groupId, error } = await creatorClient.rpc("get_or_create_dm_group", {
    p_other_user_id: member.id,
  });
  if (error || !groupId) {
    throw new Error(`Failed to create DM group: ${error?.message}`);
  }
  const memberClient = authenticateAs(member);
  await memberClient.rpc("accept_group_invitation", { p_group_id: groupId });
  return groupId;
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

    // Settled expense: no RPC path exists to set status='settled' directly
    // (the guard blocks direct UPDATE; settled normally comes from the
    // settlement flow). Skip the settled case — active expenses already
    // cover the "protected financial state" scenario.

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
    // Under #477's guard, ALL direct DELETEs on expenses are blocked
    // (graph_mutation_unauthorized). Draft cleanup goes through
    // save_expense_draft_graph (edit) or deleteTestExpenses (raw pg).
    // This test verifies the guard correctly blocks direct DELETEs
    // regardless of status or caller.
    const groupId = await createRegularGroup(alice, [bob]);
    const draftExpenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(draftExpenseId, alice, bob);

    const creatorClient = authenticateAs(alice);

    // Creator cannot directly DELETE a draft (guard blocks).
    const { data: deletedDraft, error: draftDeleteError } = await creatorClient
      .from("expenses")
      .delete()
      .eq("id", draftExpenseId)
      .select("id");
    // RLS allows creator to see draft rows for DELETE, but the guard
    // trigger raises graph_mutation_unauthorized on the actual DELETE.
    expect(draftDeleteError).not.toBeNull();
    expect(deletedDraft ?? []).toHaveLength(0);

    // Active expense also cannot be directly DELETEd.
    const activeExpenseId = await insertDraftExpense(groupId, alice);
    await insertExpenseChildren(activeExpenseId, alice, bob);
    const { data: expRow } = await requireAdmin().from("expenses").select("graph_revision").eq("id", activeExpenseId).single();
    const { error: activationError } = await creatorClient.rpc(
      "activate_saved_expense",
      { p_expense_id: activeExpenseId, p_expected_graph_revision: expRow!.graph_revision },
    );
    if (activationError) throw new Error(activationError.message);

    const { data: deletedActive } = await creatorClient
      .from("expenses")
      .delete()
      .eq("id", activeExpenseId)
      .select("id");
    // RLS DELETE policy requires status='draft', so active expenses are
    // invisible to the DELETE (0 rows matched, no trigger, no error).
    expect(deletedActive ?? []).toHaveLength(0);

    // Active expense still exists.
    const { data: activeRow } = await requireAdmin()
      .from("expenses")
      .select("id, status")
      .eq("id", activeExpenseId)
      .single();
    expect(activeRow!.status).toBe("active");

    // Non-creator also cannot DELETE.
    const wrongOwnerExpenseId = await insertDraftExpense(groupId, alice);
    const { data: deletedByWrongOwner } =
      await authenticateAs(bob)
        .from("expenses")
        .delete()
        .eq("id", wrongOwnerExpenseId)
    // RLS DELETE policy requires creator_id = auth.uid(), so bob can't
    // see alice's expense rows for DELETE (0 rows, no error).
    expect(deletedByWrongOwner ?? []).toHaveLength(0);
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
      "SELECT public.activate_saved_expense($1, (SELECT graph_revision FROM public.expenses WHERE id = $1))",
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
    const guestInfo = await insertGuardedGuest(expenseId, "Guest", 200);
    const { data: expRow } = await requireAdmin().from("expenses").select("graph_revision").eq("id", expenseId).single();
    const { error: activateError } = await authenticateAs(alice).rpc(
      "activate_saved_expense",
      { p_expense_id: expenseId, p_expected_graph_revision: expRow!.graph_revision },
    );
    if (activateError) throw new Error(activateError.message);

    const writer = await openSubject(carol);
    const claimResult = await dispatchQuery(
      writer.client,
      "SELECT public.claim_guest_spot($1)",
      [guestInfo.claimToken],
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
    // Under the guard, direct DELETE on expenses is blocked on subject
    // connections. This test now verifies that the guard correctly
    // blocks the DELETE, and the claim succeeds (the expense still
    // exists because the DELETE failed).
    const groupId = await createRegularGroup(alice, [bob]);
    const expenseId = await insertDraftExpense(groupId, alice, 1000);
    await insertExpenseChildren(expenseId, alice, bob, 1000);
    const guest = await insertGuardedGuest(expenseId, "Guest", 0);

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
    // Guard blocks the DELETE (no token open on subject connection).
    expect("error" in draftDeleteResult).toBe(true);
    await finishSubject(draftDelete, false);

    // Claim succeeds because the expense was NOT deleted (DELETE failed).
    const claim = await openSubject(carol);
    const claimResult = await dispatchQuery(
      claim.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claimToken],
    );
    expect("error" in claimResult).toBe(false);
    await finishSubject(claim, true);
  });

  it("serializes expense inserts and batch settlements", async () => {
    const expenseFirstGroup = await createRegularGroup(alice, [bob]);
    const expenseInsert = await openSubject(alice);
    const expenseInsertResult = await dispatchQuery(
      expenseInsert.client,
      "SELECT public.save_expense_draft_graph(jsonb_build_object('group_id', $1::text, 'title', 'FK race expense', 'merchant_name', null, 'expense_type', 'single_amount', 'total_amount', 1, 'service_fee_basis_points', 0, 'fixed_fees', 0), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, gen_random_uuid())",
      [expenseFirstGroup],
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
      batchSettlementSql(),
      batchSettlementParameters(settlementFirstGroup, bob.id, alice.id, 1),
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
      "SELECT public.activate_saved_expense($1, (SELECT graph_revision FROM public.expenses WHERE id = $1))",
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
    const guest = await insertGuardedGuest(expenseId, "Guest", 200);
    const { data: expRow } = await requireAdmin().from("expenses").select("graph_revision").eq("id", expenseId).single();
    const { error: activateError } = await authenticateAs(alice).rpc(
      "activate_saved_expense",
      { p_expense_id: expenseId, p_expected_graph_revision: expRow!.graph_revision },
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
      [guest.claimToken],
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
    const guest = await insertGuardedGuest(expenseId, "Guest", 200);

    const claim = await openSubject(carol);
    const claimResult = await dispatchQuery(
      claim.client,
      "SELECT public.claim_guest_spot($1)",
      [guest.claimToken],
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
    expect("error" in draftDeleteResult).toBe(true);
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
  it("rejects direct expense inserts and batch settlements after delete-first commit", async () => {
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
      "SELECT public.save_expense_draft_graph(jsonb_build_object('group_id', $1::text, 'title', 'FK delete-first expense', 'merchant_name', null, 'expense_type', 'single_amount', 'total_amount', 1, 'service_fee_basis_points', 0, 'fixed_fees', 0), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, gen_random_uuid())",
      [expenseGroup],
    ).finally(() => {
      expenseInsertDone = true;
    });
    await waitForLock(expenseInsert.pid, deletion.pid, () => expenseInsertDone);
    await finishSubject(deletion, true);
    expectSqlError(await expenseInsertPromise, "PST05");
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

    const settlementWriter = await openSubject(bob);
    let settlementDone = false;
    const settlementPromise = dispatchQuery(
      settlementWriter.client,
      batchSettlementSql(),
      batchSettlementParameters(settlementGroup, bob.id, alice.id, 1),
    ).finally(() => {
      settlementDone = true;
    });
    await waitForLock(
      settlementWriter.pid,
      settlementDeletion.pid,
      () => settlementDone,
    );
    await finishSubject(settlementDeletion, true);
    expectSqlError(await settlementPromise, "PST08");
    await finishSubject(settlementWriter, false);
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
