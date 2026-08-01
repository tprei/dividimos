import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import type { Database, Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Helper: call the save_expense_draft RPC via an authenticated client.
// ---------------------------------------------------------------------------

interface SaveDraftArgs {
  expense: Json;
  items?: Json[];
  shares?: Json[];
  payers?: Json[];
  guests?: Json[];
  guestShares?: Json[];
}

async function callSaveDraft(
  user: TestUser,
  args: SaveDraftArgs,
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const client = authenticateAs(user);
  const { data, error } = await client.rpc("save_expense_draft", {
    p_expense: args.expense,
    p_items: args.items ?? [],
    p_shares: args.shares ?? [],
    p_payers: args.payers ?? [],
    p_guests: args.guests ?? [],
    p_guest_shares: args.guestShares ?? [],
  });
  return { data: data as { id: string } | null, error };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!isIntegrationTestReady)("save_expense_draft RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      createTestUser({ name: "Alice SaveDraft" }),
      createTestUser({ name: "Bob SaveDraft" }),
    ]);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  // -------------------------------------------------------------------------
  // Happy path: new draft
  // -------------------------------------------------------------------------

  it("creates a new draft expense and returns its id", async () => {
    const { data, error } = await callSaveDraft(alice, {
      expense: {
        group_id: groupId,
        title: "Happy path dinner",
        expense_type: "single_amount",
        total_amount: 10000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      shares: [
        { user_id: alice.id, share_amount_cents: 5000 },
        { user_id: bob.id, share_amount_cents: 5000 },
      ],
      payers: [{ user_id: alice.id, amount_cents: 10000 }],
    });

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    const { data: rows } = await adminClient!
      .from("expense_shares")
      .select("share_amount_cents")
      .eq("expense_id", data!.id)
      .order("share_amount_cents");

    expect(rows).toHaveLength(2);
    expect(rows![0].share_amount_cents).toBe(5000);
    expect(rows![1].share_amount_cents).toBe(5000);
  });

  it("allows a group creator without a group_members row to create a guest expense", async () => {
    const { data: creatorOnlyGroup, error: creatorOnlyGroupError } = await adminClient!
      .from("groups")
      .insert({ name: "Creator only group", creator_id: alice.id })
      .select("id")
      .single();

    expect(creatorOnlyGroupError).toBeNull();
    expect(creatorOnlyGroup).not.toBeNull();

    const { data: creatorMemberships, error: creatorMembershipsError } = await adminClient!
      .from("group_members")
      .select("user_id")
      .eq("group_id", creatorOnlyGroup!.id)
      .eq("user_id", alice.id);

    expect(creatorMembershipsError).toBeNull();
    expect(creatorMemberships).toHaveLength(0);

    const { data, error } = await callSaveDraft(alice, {
      expense: {
        group_id: creatorOnlyGroup!.id,
        title: "Dinner with guest",
        expense_type: "single_amount",
        total_amount: 10000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      shares: [{ user_id: alice.id, share_amount_cents: 5000 }],
      payers: [{ user_id: alice.id, amount_cents: 10000 }],
      guests: [{ local_id: "guest-1", display_name: "Maria" }],
      guestShares: [{ local_id: "guest-1", share_amount_cents: 5000 }],
    });

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Happy path: update replaces child rows atomically
  // -------------------------------------------------------------------------

  it("updates an existing draft and replaces all child rows", async () => {
    const { data: firstSave } = await callSaveDraft(alice, {
      expense: {
        group_id: groupId,
        title: "First version",
        expense_type: "single_amount",
        total_amount: 6000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      shares: [
        { user_id: alice.id, share_amount_cents: 3000 },
        { user_id: bob.id, share_amount_cents: 3000 },
      ],
      payers: [{ user_id: alice.id, amount_cents: 6000 }],
    });

    expect(firstSave?.id).toBeTruthy();
    const expenseId = firstSave!.id;

    // Second save: different total, different shares
    const { data: secondSave, error: secondError } = await callSaveDraft(alice, {
      expense: {
        id: expenseId,
        group_id: groupId,
        title: "Updated version",
        expense_type: "single_amount",
        total_amount: 8000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      shares: [{ user_id: alice.id, share_amount_cents: 8000 }],
      payers: [{ user_id: alice.id, amount_cents: 8000 }],
    });

    expect(secondError).toBeNull();
    expect(secondSave?.id).toBe(expenseId);

    // Only Alice's share must remain (Bob's 3000 row was deleted)
    const { data: shareRows } = await adminClient!
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expenseId);

    expect(shareRows).toHaveLength(1);
    expect(shareRows![0].user_id).toBe(alice.id);
    expect(shareRows![0].share_amount_cents).toBe(8000);
  });

  // -------------------------------------------------------------------------
  // Status guard: save must be rejected for non-draft expenses
  // -------------------------------------------------------------------------

  it("rejects save when expense is already active", async () => {
    // Create and activate an expense via admin so we bypass the save RPC
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Soon active",
        expense_type: "single_amount",
        total_amount: 4000,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();

    const expenseId = expense!.id;

    await adminClient!.from("expense_shares").insert([
      { expense_id: expenseId, user_id: alice.id, share_amount_cents: 2000 },
      { expense_id: expenseId, user_id: bob.id, share_amount_cents: 2000 },
    ]);
    await adminClient!.from("expense_payers").insert([
      { expense_id: expenseId, user_id: alice.id, amount_cents: 4000 },
    ]);

    // Activate via the RPC
    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expenseId });

    // Now attempt to save-draft the same expense
    const { error } = await callSaveDraft(alice, {
      expense: {
        id: expenseId,
        group_id: groupId,
        title: "Mutated after activation",
        expense_type: "single_amount",
        total_amount: 4000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid_status/);
  });

  // -------------------------------------------------------------------------
  // Permission guard: only creator can save
  // -------------------------------------------------------------------------

  it("rejects save when caller is not the creator", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Alice expense",
        expense_type: "single_amount",
        total_amount: 5000,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();

    const expenseId = expense!.id;

    // Bob tries to overwrite Alice's draft
    const { error } = await callSaveDraft(bob, {
      expense: {
        id: expenseId,
        group_id: groupId,
        title: "Bob hijacked",
        expense_type: "single_amount",
        total_amount: 5000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission_denied/);
  });

  // -------------------------------------------------------------------------
  // Auth guard: unauthenticated call is rejected
  // -------------------------------------------------------------------------

  it("rejects unauthenticated calls", async () => {
    const anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const { error } = await anonClient.rpc("save_expense_draft", {
      p_expense: {
        group_id: groupId,
        title: "Anon attempt",
        expense_type: "single_amount",
        total_amount: 1000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [],
      p_payers: [],
      p_guests: [],
      p_guest_shares: [],
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/auth_required/);
  });

  // -------------------------------------------------------------------------
  // Group membership guard: non-member cannot create a draft in a foreign group
  // -------------------------------------------------------------------------

  it("rejects new draft when caller is not a member of the target group", async () => {
    // carol is not a member of the alice+bob group
    const carol = await createTestUser({ name: "Carol NonMember" });

    const { error } = await callSaveDraft(carol, {
      expense: {
        group_id: groupId,
        title: "Carol infiltrates",
        expense_type: "single_amount",
        total_amount: 1000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission_denied/);
  });

  // -------------------------------------------------------------------------
  // Concurrent activate + save: row locking preserves the active graph
  //
  // Both RPCs are fired at the same instant via Promise.all so they race
  // through the network and hit the DB concurrently. PostgreSQL's FOR UPDATE
  // inside save_expense_draft serialises them. The save supplies a valid
  // replacement graph, so either legal lock order must leave an active expense
  // with the exact shares and payer amount:
  //   (a) activation locks first, so save returns invalid_status; or
  //   (b) save locks first, returns the same expense id, and activation follows.
  // -------------------------------------------------------------------------

  it("concurrent activate and save produce a coherent final state", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Concurrent lock test",
        expense_type: "single_amount",
        total_amount: 6000,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();

    const expenseId = expense!.id;

    await adminClient!.from("expense_shares").insert([
      { expense_id: expenseId, user_id: alice.id, share_amount_cents: 3000 },
      { expense_id: expenseId, user_id: bob.id, share_amount_cents: 3000 },
    ]);
    await adminClient!.from("expense_payers").insert([
      { expense_id: expenseId, user_id: alice.id, amount_cents: 6000 },
    ]);

    // Two independent authenticated clients so there are two distinct
    // PostgREST connections — each request goes through a separate
    // server-side transaction. callSaveDraft internally calls authenticateAs
    // and creates its own client, giving us the second connection.
    const aliceClientA = authenticateAs(alice);

    const { result: [activateResult, saveResult], contention } =
      await forceLockContentionRace(
        process.env.SUPABASE_DB_URL!,
        {
          lockSql: "select id from expenses where id = $1 for update",
          lockParams: [expenseId],
          queryContains: ["activate_expense", "save_expense_draft"],
          expectedRacers: 2,
        },
        () =>
          Promise.all([
            aliceClientA.rpc("activate_expense", { p_expense_id: expenseId }),
            callSaveDraft(alice, {
              expense: {
                id: expenseId,
                group_id: groupId,
                title: "Concurrent save attempt",
                expense_type: "single_amount",
                total_amount: 6000,
                service_fee_percent: 0,
                fixed_fees: 0,
              },
              shares: [
                { user_id: alice.id, share_amount_cents: 3000 },
                { user_id: bob.id, share_amount_cents: 3000 },
              ],
              payers: [{ user_id: alice.id, amount_cents: 6000 }],
            }),
          ]),
      );

    expect(contention.observed).toBe(true);

    // Either legal lock order is coherent: whichever request loses the row
    // lock observes the other's committed effect and fails accordingly, but
    // the two writers can never BOTH lose — at least one must succeed.
    if (activateResult.error) {
      expect(activateResult.error.message).toMatch(/invalid_status/);
    }
    if (saveResult.error) {
      expect(saveResult.error.message).toMatch(/invalid_status/);
    } else {
      expect(saveResult.data?.id).toBe(expenseId);
    }
    expect(activateResult.error === null || saveResult.error === null).toBe(true);

    const [
      { data: shareRows, error: sharesError },
      { data: payerRows, error: payersError },
      { data: expenseRow, error: expenseError },
    ] = await Promise.all([
      adminClient!
        .from("expense_shares")
        .select("user_id, share_amount_cents")
        .eq("expense_id", expenseId),
      adminClient!
        .from("expense_payers")
        .select("amount_cents")
        .eq("expense_id", expenseId),
      adminClient!
        .from("expenses")
        .select("status")
        .eq("id", expenseId)
        .single(),
    ]);

    expect(sharesError).toBeNull();
    expect(payersError).toBeNull();
    expect(expenseError).toBeNull();
    expect(shareRows).toHaveLength(2);
    expect(shareRows).toEqual(
      expect.arrayContaining([
        { user_id: alice.id, share_amount_cents: 3000 },
        { user_id: bob.id, share_amount_cents: 3000 },
      ]),
    );
    expect(payerRows).toHaveLength(1);
    const payerTotal = payerRows!.reduce(
      (total, payer) => total + payer.amount_cents,
      0,
    );
    expect(payerTotal).toBe(6000);
    expect(expenseRow?.status).toBe("active");
  });

  // -------------------------------------------------------------------------
  // Guest support: guests and guest shares are written correctly
  // -------------------------------------------------------------------------

  it("creates guests with shares using local_id correlation", async () => {
    const { data, error } = await callSaveDraft(alice, {
      expense: {
        group_id: groupId,
        title: "Guest dinner",
        expense_type: "single_amount",
        total_amount: 9000,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      shares: [{ user_id: alice.id, share_amount_cents: 6000 }],
      payers: [{ user_id: alice.id, amount_cents: 9000 }],
      guests: [
        { local_id: "g1", display_name: "Maria" },
        { local_id: "g2", display_name: "Joao" },
      ],
      guestShares: [
        { local_id: "g1", share_amount_cents: 2000 },
        { local_id: "g2", share_amount_cents: 1000 },
      ],
    });

    expect(error).toBeNull();
    const expenseId = data!.id;

    const { data: guestRows } = await adminClient!
      .from("expense_guests")
      .select("id, display_name")
      .eq("expense_id", expenseId)
      .order("display_name");

    expect(guestRows).toHaveLength(2);

    const { data: guestShareRows } = await adminClient!
      .from("expense_guest_shares")
      .select("share_amount_cents")
      .eq("expense_id", expenseId)
      .order("share_amount_cents");

    expect(guestShareRows).toHaveLength(2);
    expect(guestShareRows![0].share_amount_cents).toBe(1000);
    expect(guestShareRows![1].share_amount_cents).toBe(2000);
  });
});
