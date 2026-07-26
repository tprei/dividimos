import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  createTestGroupWithMembers,
  createTestUsers,
  authenticateAs,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";

// Issue #468 guest-claim rewrite: claim_guest_spot must apply the
// guest's STORED pending plan edges to the claimant — no per-payer
// ROUND. The canonical regression is a 1-cent guest share funded by
// two 1-cent payers: the old per-payer body charged the claimant
// ROUND(1*1/2) = 1 cent to EACH payer, i.e. 2 cents total for a
// 1-cent share. The deterministic plan builder stores a SINGLE
// pending guest edge of 1 cent, so the claimant must owe exactly
// 1 cent.
//
// Fixture (total 2):
//   alice: share 1, payer 1  -> net  0 (one-cent payer AND sharer)
//   bob:   share 0, payer 1  -> net -1 (creditor; one-cent payer)
//   guest: share 1, payer 0  -> net +1 (debtor)
// Builder stores exactly one pending edge: guest(debtor) -> bob(creditor), amount 1.
// carol (not a participant) claims -> owes bob exactly 1 cent.

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

type EntityRow = {
  participant_index: number;
  entity_kind: "user" | "guest";
  user_id: string | null;
  guest_id: string | null;
  share_amount_cents: number;
  payer_amount_cents: number;
  net_amount_cents: number;
};

type EdgeRow = {
  allocation_index: number;
  debtor_index: number;
  creditor_index: number;
  amount_cents: number;
  applied_to_user_id: string | null;
  applied_at: string | null;
};

describe.skipIf(!canRun)("claim_guest_spot allocation plan (#468)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  let expenseId: string;
  let guestId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
  });

  afterAll(async () => {
    if (expenseId && adminClient) {
      // Cascades to entities, plan, edges, shares, payers, guest rows.
      await adminClient.from("expenses").delete().eq("id", expenseId);
    }
    if (pg) await pg.end();
  });

  async function buildFixture(): Promise<void> {
    [alice, bob, carol] = await createTestUsers(3);
    for (const u of [alice, bob, carol]) registerTestUser(u.id);

    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;

    // Draft expense, total 2 cents.
    const { data: expense, error: expError } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "#468 claim fixture [1,0,g1]/[1,1]",
        expense_type: "single_amount",
        total_amount: 2,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();
    if (expError || !expense) throw new Error(`create expense: ${expError?.message}`);
    expenseId = expense.id;

    const { data: guest, error: guestError } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expenseId, display_name: "Future carol" })
      .select("id, claim_token")
      .single();
    if (guestError || !guest) throw new Error(`create guest: ${guestError?.message}`);
    guestId = guest.id;

    // alice: share 1 + pays 1. bob: zero share + pays 1. guest: share 1.
    const sharesRes = await adminClient!.from("expense_shares").insert([
      { expense_id: expenseId, user_id: alice.id, share_amount_cents: 1 },
      { expense_id: expenseId, user_id: bob.id, share_amount_cents: 0 },
    ]);
    const [guestShareRes, payersRes] = await Promise.all([
      adminClient!.from("expense_guest_shares").insert([
        { expense_id: expenseId, guest_id: guestId, share_amount_cents: 1 },
      ]),
      adminClient!.from("expense_payers").insert([
        { expense_id: expenseId, user_id: alice.id, amount_cents: 1 },
        { expense_id: expenseId, user_id: bob.id, amount_cents: 1 },
      ]),
    ]);
    if (sharesRes.error) throw new Error(`shares: ${sharesRes.error.message}`);
    if (guestShareRes.error)
      throw new Error(`guest shares: ${guestShareRes.error.message}`);
    if (payersRes.error) throw new Error(`payers: ${payersRes.error.message}`);

    const creatorClient = authenticateAs(alice);
    const { error: rpcError } = await creatorClient.rpc("activate_expense", {
      p_expense_id: expenseId,
    });
    if (rpcError) throw new Error(`activate: ${rpcError.message}`);

    // Stash the claim token on the fixture guest row for the claim step.
    guestClaimToken = guest.claim_token;
  }

  let guestClaimToken = "";

  it("stores a single pending 1-cent guest edge before the claim", async () => {
    await buildFixture();

    const { rows: entities } = await pg.query<EntityRow>(
      `select participant_index, entity_kind, user_id, guest_id,
              share_amount_cents, payer_amount_cents, net_amount_cents
         from expense_allocation_entities
        where expense_id = $1
        order by participant_index`,
      [expenseId],
    );

    const aliceEntity = entities.find((e) => e.user_id === alice.id)!;
    const bobEntity = entities.find((e) => e.user_id === bob.id)!;
    const guestEntity = entities.find((e) => e.guest_id === guestId)!;
    expect(aliceEntity.net_amount_cents).toBe(0);
    expect(bobEntity.net_amount_cents).toBe(-1);
    expect(guestEntity.net_amount_cents).toBe(1);

    const { rows: edges } = await pg.query<EdgeRow>(
      `select allocation_index, debtor_index, creditor_index, amount_cents,
              applied_to_user_id, applied_at
         from expense_balance_allocations
        where expense_id = $1
        order by allocation_index`,
      [expenseId],
    );

    // Exactly one edge: guest(debtor) -> bob(creditor), amount 1, pending.
    expect(edges).toHaveLength(1);
    expect(edges[0].debtor_index).toBe(guestEntity.participant_index);
    expect(edges[0].creditor_index).toBe(bobEntity.participant_index);
    expect(edges[0].amount_cents).toBe(1);
    expect(edges[0].applied_to_user_id).toBeNull();
    expect(edges[0].applied_at).toBeNull();
  });

  it("claims the guest for exactly 1 cent total (not 2) and applies the edge", async () => {
    // carol is not a participant and not a group member yet.
    const carolClient = authenticateAs(carol);
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guestClaimToken,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_id: guestId,
      expense_id: expenseId,
      already_claimed: false,
    });

    // The fix: carol owes exactly 1 cent total. The old per-payer
    // ROUND body charged ROUND(1*1/2)=1 to BOTH alice and bob (= 2).
    // The stored single edge charges only bob.
    const carolOwesBob = await getBalanceBetween(groupId, carol.id, bob.id);
    expect(carolOwesBob).toBe(1);

    // carol must owe alice nothing (the old bug charged alice 1 too).
    const carolOwesAlice = await getBalanceBetween(groupId, carol.id, alice.id);
    expect(carolOwesAlice).toBe(0);

    // Total outgoing balance for carol across the group is exactly 1.
    const { rows: carolBalances } = await pg.query<{ amt: number }>(
      `select coalesce(sum(
         case when user_a = $1 then amount_cents
              when user_b = $1 then -amount_cents
              else 0 end), 0)::int as amt
         from balances
        where group_id = $2 and (user_a = $1 or user_b = $1)`,
      [carol.id, groupId],
    );
    expect(carolBalances[0].amt).toBe(1);

    // Share transferred: carol now owns the guest's 1-cent share.
    const { data: carolShare } = await adminClient!
      .from("expense_shares")
      .select("share_amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", carol.id)
      .single();
    expect(carolShare).not.toBeNull();
    expect(carolShare!.share_amount_cents).toBe(1);

    // Guest share row is gone.
    const { data: remainingGuestShare } = await adminClient!
      .from("expense_guest_shares")
      .select("id")
      .eq("guest_id", guestId)
      .maybeSingle();
    expect(remainingGuestShare).toBeNull();

    // Guest is marked claimed by carol.
    const { data: claimedGuest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("id", guestId)
      .single();
    expect(claimedGuest!.claimed_by).toBe(carol.id);
    expect(claimedGuest!.claimed_at).not.toBeNull();

    // carol was added to the group as accepted.
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();
    expect(membership!.status).toBe("accepted");

    // Every formerly pending guest edge is now applied to carol.
    const { rows: edgesAfter } = await pg.query<EdgeRow>(
      `select applied_to_user_id, applied_at
         from expense_balance_allocations
        where expense_id = $1 and debtor_index = (
          select participant_index from expense_allocation_entities
           where expense_id = $1 and guest_id = $2
        )`,
      [expenseId, guestId],
    );
    expect(edgesAfter.length).toBeGreaterThan(0);
    for (const e of edgesAfter) {
      expect(e.applied_to_user_id).toBe(carol.id);
      expect(e.applied_at).not.toBeNull();
    }
  });

  it("is idempotent: re-claiming as the same caller returns already_claimed with no balance change", async () => {
    const carolClient = authenticateAs(carol);
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guestClaimToken,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ already_claimed: true });

    // No further balance change: carol still owes exactly 1 cent total.
    const carolOwesBob = await getBalanceBetween(groupId, carol.id, bob.id);
    expect(carolOwesBob).toBe(1);
    const carolOwesAlice = await getBalanceBetween(groupId, carol.id, alice.id);
    expect(carolOwesAlice).toBe(0);

    // Only one share row for carol (no duplicate from the idempotent call).
    const { data: carolShares } = await adminClient!
      .from("expense_shares")
      .select("id")
      .eq("expense_id", expenseId)
      .eq("user_id", carol.id);
    expect(carolShares).toHaveLength(1);
  });

  it("denies a second claim by a different caller with PST05", async () => {
    // A brand-new user (not carol) attempts the already-claimed token.
    const [dave] = await createTestUsers(1);
    registerTestUser(dave.id);
    const daveClient = authenticateAs(dave);
    const { error } = await daveClient.rpc("claim_guest_spot", {
      p_claim_token: guestClaimToken,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("PST05");
    expect(error!.message).toContain("already_claimed");
  });
});
