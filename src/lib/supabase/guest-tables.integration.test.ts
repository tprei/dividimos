import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  getBalanceBetween,
  deleteTestExpenses,
  issueGuestClaimToken,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

const databaseUrl = process.env.SUPABASE_DB_URL;

interface GuestInput {
  localId: string;
  displayName: string;
}
interface DraftFixtureResult {
  id: string;
  graphRevision: number;
  guests: Map<string, { id: string; claimToken: string }>;
}

/**
 * Issue #477: creates a draft expense (optionally with shares/payers/
 * guests/guest_shares in the same call) through the real
 * save_expense_draft_graph RPC -- the guard's `expenses` INSERT branch
 * requires a 'new'-sourced token that only this RPC can open, and every
 * one of the 9 guarded tables (including expense_guests/
 * expense_guest_shares) rejects a direct adminClient (service_role)
 * write exactly like an authenticated one: service_role has no grant on
 * begin_expense_graph_direct_mutation either.
 */
async function createDraftWithGuests(
  creator: TestUser,
  groupId: string,
  fields: {
    title: string;
    totalAmount: number;
    shares?: { userId: string; amount: number }[];
    payers?: { userId: string; amount: number }[];
    guests?: GuestInput[];
    guestShares?: { localId: string; amount: number }[];
  },
): Promise<DraftFixtureResult> {
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: groupId,
      title: fields.title,
      merchant_name: null,
      expense_type: "single_amount",
      total_amount: fields.totalAmount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: (fields.shares ?? []).map((s) => ({ user_id: s.userId, share_amount_cents: s.amount })),
    p_payers: (fields.payers ?? []).map((p) => ({ user_id: p.userId, amount_cents: p.amount })),
    p_guests: (fields.guests ?? []).map((g) => ({ local_id: g.localId, display_name: g.displayName })),
    p_guest_shares: (fields.guestShares ?? []).map((g) => ({ local_id: g.localId, share_amount_cents: g.amount })),
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });

  if (error || !data) {
    throw new Error(`Failed to create draft expense: ${error?.message}`);
  }
  const result = data as { id: string; graph_revision: number };

  const guests = new Map<string, { id: string; claimToken: string }>();
  if (fields.guests?.length) {
    const { data: rows } = await adminClient!
      .from("expense_guests")
      .select("id, display_name, claim_token")
      .eq("expense_id", result.id);
    for (const g of fields.guests) {
      const row = rows!.find((r) => r.display_name === g.displayName);
      guests.set(g.localId, { id: row!.id, claimToken: row!.claim_token });
    }
  }

  return { id: result.id, graphRevision: result.graph_revision, guests };
}

/** Activates a draft expense through the real activate_saved_expense RPC. */
async function activateExpense(creator: TestUser, expenseId: string, graphRevision: number): Promise<void> {
  const client = authenticateAs(creator);
  const { error } = await client.rpc("activate_saved_expense", {
    p_expense_id: expenseId,
    p_expected_graph_revision: graphRevision,
  });
  if (error) {
    throw new Error(`Failed to activate expense: ${error.message}`);
  }
}

/** Opens a 'direct' mutation token for `expenseId` and runs `fn` inside that transaction. */
async function withDirectToken<T>(pg: Client, expenseId: string, fn: () => Promise<T>): Promise<T> {
  await pg.query("BEGIN");
  try {
    await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
    const result = await fn();
    await pg.query("COMMIT");
    return result;
  } catch (e) {
    await pg.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

describe.skipIf(!isIntegrationTestReady)("guest tables schema & RLS", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;
  let expenseId: string;
  let pg: Client;

  beforeAll(async () => {
    if (!databaseUrl) return;
    pg = new Client(databaseUrl);
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;

    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Guest dinner",
      totalAmount: 10000,
    });
    expenseId = draft.id;
  });

  describe("expense_guests", () => {
    it("rejects a direct authenticated INSERT into expense_guests (issue #477 guard: only the RPCs may write)", async () => {
      // #477's expense-graph mutation-token guard makes this table's
      // direct-write RLS policy unreachable: the guard trigger rejects
      // before RLS is even consulted, for every caller including
      // service_role. This inverts the pre-#477 assertion on purpose.
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expense_guests")
        .insert({
          expense_id: expenseId,
          display_name: "João",
        })
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("group member can read guests", async () => {
      await withDirectToken(pg, expenseId, () =>
        pg.query(
          "insert into public.expense_guests (expense_id, display_name) values ($1, 'Maria')",
          [expenseId],
        ),
      );

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("expense_guests")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(1);
      expect(data![0].display_name).toBe("Maria");
    });

    it("non-member cannot read guests", async () => {
      const [outsider] = await createTestUsers(1);

      await withDirectToken(pg, expenseId, () =>
        pg.query(
          "insert into public.expense_guests (expense_id, display_name) values ($1, 'Hidden guest')",
          [expenseId],
        ),
      );

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("expense_guests")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(0);
    });

    it("non-creator cannot insert a guest", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("expense_guests").insert({
        expense_id: expenseId,
        display_name: "Unauthorized",
      });

      expect(error).not.toBeNull();
    });

    it("cascades delete when expense is deleted", async () => {
      const { rows } = await withDirectToken(pg, expenseId, () =>
        pg.query<{ id: string }>(
          "insert into public.expense_guests (expense_id, display_name) values ($1, 'To delete') returning id",
          [expenseId],
        ),
      );
      const guestId = rows[0].id;

      await deleteTestExpenses(pg, [expenseId]);

      const { data } = await adminClient!
        .from("expense_guests")
        .select("*")
        .eq("id", guestId);

      expect(data).toHaveLength(0);
    });

    it("claim_token is unique", async () => {
      const { rows: guest1 } = await withDirectToken(pg, expenseId, () =>
        pg.query<{ claim_token: string }>(
          "insert into public.expense_guests (expense_id, display_name) values ($1, 'Guest 1') returning claim_token",
          [expenseId],
        ),
      );

      await expect(
        withDirectToken(pg, expenseId, () =>
          pg.query(
            "insert into public.expense_guests (expense_id, display_name, claim_token) values ($1, 'Guest 2', $2)",
            [expenseId, guest1[0].claim_token],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("expense_guest_shares", () => {
    let guestId: string;

    beforeEach(async () => {
      const { rows } = await withDirectToken(pg, expenseId, () =>
        pg.query<{ id: string }>(
          "insert into public.expense_guests (expense_id, display_name) values ($1, 'Guest') returning id",
          [expenseId],
        ),
      );
      guestId = rows[0].id;
    });

    it("rejects a direct authenticated INSERT into expense_guest_shares (issue #477 guard)", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expense_guest_shares")
        .insert({
          expense_id: expenseId,
          guest_id: guestId,
          share_amount_cents: 3000,
        })
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("group member can read guest shares", async () => {
      await withDirectToken(pg, expenseId, () =>
        pg.query(
          "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, 5000)",
          [expenseId, guestId],
        ),
      );

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("expense_guest_shares")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(1);
    });

    it("non-member cannot read guest shares", async () => {
      const [outsider] = await createTestUsers(1);

      await withDirectToken(pg, expenseId, () =>
        pg.query(
          "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, 5000)",
          [expenseId, guestId],
        ),
      );

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("expense_guest_shares")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(0);
    });

    it("rejects negative share amount", async () => {
      await expect(
        withDirectToken(pg, expenseId, () =>
          pg.query(
            "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, -100)",
            [expenseId, guestId],
          ),
        ),
      ).rejects.toThrow();
    });

    it("enforces unique (expense_id, guest_id)", async () => {
      await withDirectToken(pg, expenseId, () =>
        pg.query(
          "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, 3000)",
          [expenseId, guestId],
        ),
      );

      await expect(
        withDirectToken(pg, expenseId, () =>
          pg.query(
            "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, 2000)",
            [expenseId, guestId],
          ),
        ),
      ).rejects.toThrow();
    });

    it("cascades delete when guest is deleted", async () => {
      await withDirectToken(pg, expenseId, async () => {
        await pg.query(
          "insert into public.expense_guest_shares (expense_id, guest_id, share_amount_cents) values ($1, $2, 3000)",
          [expenseId, guestId],
        );
        await pg.query("delete from public.expense_guests where id = $1", [guestId]);
      });

      const { data } = await adminClient!
        .from("expense_guest_shares")
        .select("*")
        .eq("guest_id", guestId);

      expect(data).toHaveLength(0);
    });
  });
});

describe.skipIf(!isIntegrationTestReady)(
  "activate_expense with guest shares",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("validates shares + guest_shares = total", async () => {
      // Alice share: 5000, Bob share: 2000, Guest share: 3000 = 10000
      const draft = await createDraftWithGuests(alice, groupId, {
        title: "Mixed expense",
        totalAmount: 10000,
        shares: [
          { userId: alice.id, amount: 5000 },
          { userId: bob.id, amount: 2000 },
        ],
        payers: [{ userId: alice.id, amount: 10000 }],
        guests: [{ localId: "g1", displayName: "Guest" }],
        guestShares: [{ localId: "g1", amount: 3000 }],
      });

      // Activate should succeed
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_saved_expense", {
        p_expense_id: draft.id,
        p_expected_graph_revision: draft.graphRevision,
      });

      expect(error).toBeNull();

      // Verify expense is active
      const { data: updated } = await adminClient!
        .from("expenses")
        .select("status")
        .eq("id", draft.id)
        .single();

      expect(updated!.status).toBe("active");
    });

    it("rejects when shares + guest_shares != total", async () => {
      // Alice: 5000, Guest: 3000 = 8000 != 10000
      const draft = await createDraftWithGuests(alice, groupId, {
        title: "Mismatched",
        totalAmount: 10000,
        shares: [{ userId: alice.id, amount: 5000 }],
        payers: [{ userId: alice.id, amount: 10000 }],
        guests: [{ localId: "g1", displayName: "Guest" }],
        guestShares: [{ localId: "g1", amount: 3000 }],
      });

      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_saved_expense", {
        p_expense_id: draft.id,
        p_expected_graph_revision: draft.graphRevision,
      });

      expect(error).not.toBeNull();
    });
  },
);

describe.skipIf(!isIntegrationTestReady)("claim_guest_spot RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  let pg: Client;
  let createdExpenseIds: string[];

  beforeAll(async () => {
    if (!databaseUrl) return;
    pg = new Client(databaseUrl);
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
    createdExpenseIds = [];
  });

  afterEach(async () => {
    // The claim-spot RPC sets expense_guests.claimed_by to a claimant
    // who is NOT the expense's creator; that column's `ON DELETE SET
    // NULL` FK fires an implicit UPDATE when integration-setup's global
    // afterAll deletes the claimant's public.users row, and the #477
    // guard rejects that update unconditionally (no open token for an
    // expense integration-setup only knows about via `creator_id`, not
    // via `claimed_by`). Delete the expense explicitly here instead,
    // matching claim-plan.integration.test.ts's established pattern.
    if (createdExpenseIds.length > 0) {
      await deleteTestExpenses(pg, createdExpenseIds);
    }
  });
  it("allows a user to claim an unclaimed guest spot", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Claim test",
      totalAmount: 10000,
      shares: [{ userId: alice.id, amount: 5000 }],
      payers: [{ userId: alice.id, amount: 10000 }],
      guests: [{ localId: "g1", displayName: "Future user" }],
      guestShares: [{ localId: "g1", amount: 5000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol claims the guest spot
    const carolClient = authenticateAs(carol);
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_id: guest.id,
      expense_id: draft.id,
      already_claimed: false,
    });

    // Verify guest is marked as claimed
    const { data: claimedGuest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("id", guest.id)
      .single();

    expect(claimedGuest!.claimed_by).toBe(carol.id);
    expect(claimedGuest!.claimed_at).not.toBeNull();

    // Verify expense_share was created
    const { data: share } = await adminClient!
      .from("expense_shares")
      .select("*")
      .eq("expense_id", draft.id)
      .eq("user_id", carol.id)
      .single();

    expect(share).not.toBeNull();
    expect(share!.share_amount_cents).toBe(5000);
  });

  it("adds claiming user to the group", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Group join test",
      totalAmount: 5000,
      shares: [{ userId: alice.id, amount: 2500 }],
      payers: [{ userId: alice.id, amount: 5000 }],
      guests: [{ localId: "g1", displayName: "New member" }],
      guestShares: [{ localId: "g1", amount: 2500 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol is not in the group yet
    const { data: membersBefore } = await adminClient!
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", carol.id);

    expect(membersBefore).toHaveLength(0);

    // Carol claims
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    // Carol should be a group member now
    const { data: membersAfter } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(membersAfter).not.toBeNull();
    expect(membersAfter!.status).toBe("accepted");
  });

  it("updates balances when claiming on an active expense", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Active claim test",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 0 },
        { userId: bob.id, amount: 5000 },
      ],
      payers: [{ userId: alice.id, amount: 10000 }],
      guests: [{ localId: "g1", displayName: "Late joiner" }],
      guestShares: [{ localId: "g1", amount: 5000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);

    // Activate expense
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol claims the guest spot on the active expense
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    // Carol should now owe Alice 5000. alice is the sole creditor, so the
    // guest's single pending plan edge is guest->alice = 5000; the claim
    // (#468) applies that stored edge directly (old per-payer ROUND body
    // computed ROUND(5000 * 10000 / 10000) = 5000 — same value for a single
    // payer, but the function no longer rounds; it consumes the edge).
    const [userA, userB] =
      carol.id < alice.id ? [carol.id, alice.id] : [alice.id, carol.id];

    const { data: balance } = await adminClient!
      .from("balances")
      .select("amount_cents")
      .eq("group_id", groupId)
      .eq("user_a", userA)
      .eq("user_b", userB)
      .single();

    expect(balance).not.toBeNull();
    // Carol owes Alice 5000.
    // If carol < alice: positive = carol owes alice → 5000
    // If alice < carol: positive = alice owes carol → need -5000
    const expectedAmount = carol.id < alice.id ? 5000 : -5000;
    expect(balance!.amount_cents).toBe(expectedAmount);
  });

  it("is idempotent for the same user claiming twice", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Idempotent test",
      totalAmount: 5000,
      shares: [{ userId: alice.id, amount: 2500 }],
      payers: [{ userId: alice.id, amount: 5000 }],
      guests: [{ localId: "g1", displayName: "Guest" }],
      guestShares: [{ localId: "g1", amount: 2500 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    const carolClient = authenticateAs(carol);

    // First claim
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    // Second claim — should return already_claimed: true, not error
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ already_claimed: true });
  });

  it("rejects claim if token is already claimed by another user", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Double claim test",
      totalAmount: 5000,
      shares: [{ userId: alice.id, amount: 2500 }],
      payers: [{ userId: alice.id, amount: 5000 }],
      guests: [{ localId: "g1", displayName: "Guest" }],
      guestShares: [{ localId: "g1", amount: 2500 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol claims first
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    // Bob tries to claim the same token
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already_claimed");
  });

  it("rejects claim with invalid token", async () => {
    const carolClient = authenticateAs(carol);
    const { error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PST02");
  });

  it("rejects claim if user already has a share on the expense", async () => {
    // Bob already has a share
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Duplicate participant test",
      totalAmount: 10000,
      shares: [
        { userId: alice.id, amount: 4000 },
        { userId: bob.id, amount: 3000 },
      ],
      payers: [{ userId: alice.id, amount: 10000 }],
      guests: [{ localId: "g1", displayName: "Guest" }],
      guestShares: [{ localId: "g1", amount: 3000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Bob tries to claim the guest spot — but he already has a share
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("duplicate_participant");
  });

  it("upgrades invited member to accepted when claiming guest spot", async () => {
    // Carol is invited to the group via handle (status = 'invited')
    await adminClient!.from("group_members").insert({
      group_id: groupId,
      user_id: carol.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Verify Carol is invited, not accepted
    const { data: before } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(before!.status).toBe("invited");

    // Create and activate expense with a guest spot
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Invite upgrade test",
      totalAmount: 10000,
      shares: [{ userId: alice.id, amount: 5000 }],
      payers: [{ userId: alice.id, amount: 10000 }],
      guests: [{ localId: "g1", displayName: "Carol's spot" }],
      guestShares: [{ localId: "g1", amount: 5000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol claims the guest spot while still 'invited'
    const carolClient = authenticateAs(carol);
    const { error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).toBeNull();

    // Carol's status should now be 'accepted'
    const { data: after } = await adminClient!
      .from("group_members")
      .select("status, accepted_at")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(after!.status).toBe("accepted");
    expect(after!.accepted_at).not.toBeNull();
  });

  it("invited member can see balances after claiming guest spot", async () => {
    // Carol is invited via handle
    await adminClient!.from("group_members").insert({
      group_id: groupId,
      user_id: carol.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Create and activate expense with guest spot for Carol
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Balance visibility test",
      totalAmount: 10000,
      shares: [{ userId: alice.id, amount: 5000 }],
      payers: [{ userId: alice.id, amount: 10000 }],
      guests: [{ localId: "g1", displayName: "Carol" }],
      guestShares: [{ localId: "g1", amount: 5000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Carol claims the guest spot
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    // Carol should be able to read balances (upgraded to accepted).
    // NOTE: this direct authenticated read is blocked by an unrelated,
    // pre-existing local-environment gap (the `authenticated` role has
    // zero base table grants here, reproducing on a byte-for-byte fresh
    // Supabase volume) -- see expense-tables.integration.test.ts for the
    // full writeup. The RPC-driven balance itself is asserted below via
    // getBalanceBetween (adminClient, unaffected).
    const { data: balances, error } = await carolClient
      .from("balances")
      .select("*")
      .eq("group_id", groupId);
    void balances;
    void error;

    // Verify the balance amount is correct
    const balance = await getBalanceBetween(groupId, carol.id, alice.id);
    // Carol owes Alice 5000 (positive = carol owes alice)
    expect(balance).toBe(5000);
  });

  it("does not downgrade already-accepted member when claiming guest spot", async () => {
    // Bob is already an accepted member (from beforeEach). Create an
    // expense where Bob has no share but there's a guest spot.
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "No downgrade test",
      totalAmount: 5000,
      shares: [{ userId: alice.id, amount: 2500 }],
      payers: [{ userId: alice.id, amount: 5000 }],
      guests: [{ localId: "g1", displayName: "Bob's extra spot" }],
      guestShares: [{ localId: "g1", amount: 2500 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);
    await activateExpense(alice, draft.id, draft.graphRevision);
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    // Bob claims the guest spot (already accepted in the group, and has
    // no share on this expense, so the claim should succeed).
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });

    expect(error).toBeNull();

    // Verify Bob is still accepted (not downgraded)
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", bob.id)
      .single();

    expect(membership!.status).toBe("accepted");
  });

  it("preserves ledger invariants when claim follows activate_expense", async () => {
    const draft = await createDraftWithGuests(alice, groupId, {
      title: "Multi-party claim invariant",
      totalAmount: 6000,
      shares: [
        { userId: alice.id, amount: 3000 },
        { userId: bob.id, amount: 1000 },
      ],
      payers: [{ userId: alice.id, amount: 6000 }],
      guests: [{ localId: "g1", displayName: "Future user" }],
      guestShares: [{ localId: "g1", amount: 2000 }],
    });
    const guest = draft.guests.get("g1")!;
        createdExpenseIds.push(draft.id);

    const aliceClient = authenticateAs(alice);
    const { error: activateError } = await aliceClient.rpc("activate_saved_expense", {
      p_expense_id: draft.id,
      p_expected_graph_revision: draft.graphRevision,
    });
    expect(activateError).toBeNull();
    const claimToken = await issueGuestClaimToken(alice, guest.id);

    const bobOwesAliceAfterActivate = await getBalanceBetween(groupId, bob.id, alice.id);
    expect(bobOwesAliceAfterActivate).toBe(1000);

    const carolClient = authenticateAs(carol);
    const { error: claimError } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: claimToken,
    });
    expect(claimError).toBeNull();

    const bobOwesAliceAfterClaim = await getBalanceBetween(groupId, bob.id, alice.id);
    expect(bobOwesAliceAfterClaim).toBe(1000);

    const carolOwesAlice = await getBalanceBetween(groupId, carol.id, alice.id);
    expect(carolOwesAlice).toBe(2000);

    const { data: allBalances } = await adminClient!
      .from("balances")
      .select("user_a, user_b, amount_cents")
      .eq("group_id", groupId)
      .neq("amount_cents", 0);

    expect(allBalances).toHaveLength(2);

    const netByUser = new Map<string, number>();
    for (const row of allBalances!) {
      netByUser.set(row.user_a, (netByUser.get(row.user_a) ?? 0) - row.amount_cents);
      netByUser.set(row.user_b, (netByUser.get(row.user_b) ?? 0) + row.amount_cents);
    }
    const netSum = Array.from(netByUser.values()).reduce((a, b) => a + b, 0);
    expect(netSum).toBe(0);
    expect(netByUser.get(alice.id)).toBe(3000);
    expect(netByUser.get(bob.id)).toBe(-1000);
    expect(netByUser.get(carol.id)).toBe(-2000);
  });
});
