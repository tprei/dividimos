import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, isIntegrationTestReady, registerTestUser } from "@/test/integration-setup";
import {
  createTestGroupWithMembers,
  createTestUsers,
  authenticateAs,
  deleteTestExpenses,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";

// Issue #495 Slice 2: claim_guest_spot's zero-share-payer amendment
// (20260808000000_claim_guest_spot_zero_share_payer.sql) is otherwise
// entirely untested. Every existing claim_guest_spot integration test
// (claim-plan.integration.test.ts et al.) has the *claimant* be a brand
// new participant with no prior expense_shares row at all; none of them
// exercise the specific #495 exception this migration exists for: "an
// existing user share remains duplicate_participant except when it is
// exactly zero and the claimant is already an expense_payers user for
// that same expense. In that one allowed case, lock the zero share and
// update it to the claimed guest's share amount instead of inserting a
// duplicate."
//
// Fixture (total 3, single creditor to keep the plan deterministic):
//   alice: share 2, payer 0 -> net +2 (debtor)
//   bob:   share 0, payer 3 -> net -3 (sole creditor; zero-share payer)
//   guest: share 1, payer 0 -> net +1 (debtor)
// Builder stores exactly two pending edges, both crediting bob:
//   alice(debtor) -> bob(creditor), amount 2
//   guest(debtor) -> bob(creditor), amount 1
// Bob then claims the guest himself. Because bob is *already* the
// guest's sole creditor, the guest's pending edge has
// creditor_user = caller: the "self-edge" case the migration must mark
// applied without inserting a balance row for owing yourself.

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("claim_guest_spot zero-share-payer amendment (#495)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;
  let expenseId: string;
  let guestId: string;
  let guestClaimToken: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();

    [alice, bob] = await createTestUsers(2);
    for (const u of [alice, bob]) registerTestUser(u.id);

    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;

    const creatorClient = authenticateAs(alice);
    const { data: saveResult, error: saveError } = await creatorClient.rpc(
      "save_expense_draft_graph",
      {
        p_expense: {
          group_id: groupId,
          title: "#495 zero-share-payer claim fixture [2,0,g1]/[0,3]",
          merchant_name: null,
          expense_type: "single_amount",
          total_amount: 3,
          service_fee_basis_points: 0,
          fixed_fees: 0,
        },
        p_items: [],
        p_shares: [
          { user_id: alice.id, share_amount_cents: 2 },
          { user_id: bob.id, share_amount_cents: 0 },
        ],
        p_payers: [{ user_id: bob.id, amount_cents: 3 }],
        p_guests: [{ local_id: "g1", display_name: "Future Bob" }],
        p_guest_shares: [{ local_id: "g1", share_amount_cents: 1 }],
        p_participant_order: [],
        p_expected_graph_revision: 0,
        p_save_operation_id: crypto.randomUUID(),
      },
    );
    if (saveError || !saveResult) throw new Error(`create expense: ${saveError?.message}`);

    const saved = saveResult as { id: string; graph_revision: number };
    expenseId = saved.id;

    const { data: guest, error: guestError } = await adminClient!
      .from("expense_guests")
      .select("id, claim_token")
      .eq("expense_id", expenseId)
      .single();
    if (guestError || !guest) throw new Error(`load guest: ${guestError?.message}`);
    guestId = guest.id;
    guestClaimToken = guest.claim_token!;

    const { error: activateError } = await creatorClient.rpc("activate_saved_expense", {
      p_expense_id: expenseId,
      p_expected_graph_revision: saved.graph_revision,
    });
    if (activateError) throw new Error(`activate: ${activateError.message}`);
  });

  afterAll(async () => {
    if (expenseId && pg) {
      await deleteTestExpenses(pg, [expenseId]);
    }
    if (pg) await pg.end();
  });

  it("bob (zero share, existing payer) claims the guest by updating his zero share, not inserting a duplicate", async () => {
    // Precondition: bob really is a zero-share payer before the claim.
    const { data: bobShareBefore } = await adminClient!
      .from("expense_shares")
      .select("share_amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", bob.id)
      .single();
    expect(bobShareBefore!.share_amount_cents).toBe(0);

    const { data: bobPayerBefore } = await adminClient!
      .from("expense_payers")
      .select("amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", bob.id)
      .single();
    expect(bobPayerBefore!.amount_cents).toBe(3);

    const beforeRev = await pg.query<{ graph_revision: number }>(
      "select graph_revision from expenses where id = $1",
      [expenseId],
    );

    const bobClient = authenticateAs(bob);
    const { data, error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guestClaimToken,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_id: guestId,
      expense_id: expenseId,
      already_claimed: false,
    });

    // The zero share was UPDATEd to the guest's 1-cent share, not
    // duplicated: exactly one expense_shares row for bob, now nonzero.
    const { data: bobShares } = await adminClient!
      .from("expense_shares")
      .select("id, share_amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", bob.id);
    expect(bobShares).toHaveLength(1);
    expect(bobShares![0].share_amount_cents).toBe(1);

    // The payer row is completely untouched by the claim.
    const { data: bobPayerAfter } = await adminClient!
      .from("expense_payers")
      .select("amount_cents")
      .eq("expense_id", expenseId)
      .eq("user_id", bob.id)
      .single();
    expect(bobPayerAfter!.amount_cents).toBe(3);

    // The guest share row is gone; the guest is marked claimed by bob.
    const { data: remainingGuestShare } = await adminClient!
      .from("expense_guest_shares")
      .select("id")
      .eq("guest_id", guestId)
      .maybeSingle();
    expect(remainingGuestShare).toBeNull();

    const { data: claimedGuest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("id", guestId)
      .single();
    expect(claimedGuest!.claimed_by).toBe(bob.id);
    expect(claimedGuest!.claimed_at).not.toBeNull();

    // Self-edge case: bob was already the guest's sole creditor, so the
    // pending guest(debtor) -> bob(creditor) edge must be marked applied
    // without ever inserting a "bob owes bob" balance row. Alice still
    // owes bob exactly 2 cents (her own unrelated share/payer delta from
    // activation) -- the claim must not perturb it.
    const aliceOwesBob = await getBalanceBetween(groupId, alice.id, bob.id);
    expect(aliceOwesBob).toBe(2);
    // No extra balance row was fabricated for the self-edge: exactly one
    // balances row exists for this group (alice/bob), nothing involving
    // a self-pair (which is schema-impossible under user_a < user_b, but
    // this also catches any other spurious row the self-edge path could
    // have introduced, e.g. through the wrong participant identity).
    const { rows: groupBalances } = await pg.query<{ amount_cents: number }>(
      "select amount_cents from balances where group_id = $1",
      [groupId],
    );
    expect(groupBalances).toHaveLength(1);
    // Magnitude, not sign: balances.amount_cents' sign encodes which of
    // the random-UUID-ordered (user_a, user_b) pair owes the other, not
    // which of alice/bob is which -- getBalanceBetween already
    // normalizes that for the directional assertion above.
    expect(Math.abs(groupBalances[0].amount_cents)).toBe(2);

    // Every formerly pending edge whose debtor was the guest is applied
    // to bob, including the self-edge.
    const { rows: guestEdgesAfter } = await pg.query<{
      applied_to_user_id: string | null;
      applied_at: string | null;
    }>(
      `select applied_to_user_id, applied_at
         from expense_balance_allocations
        where expense_id = $1 and debtor_index = (
          select participant_index from expense_allocation_entities
           where expense_id = $1 and guest_id = $2
        )`,
      [expenseId, guestId],
    );
    expect(guestEdgesAfter.length).toBeGreaterThan(0);
    for (const e of guestEdgesAfter) {
      expect(e.applied_to_user_id).toBe(bob.id);
      expect(e.applied_at).not.toBeNull();
    }

    // Bob was added to the group as accepted (he already was, via
    // createTestGroupWithMembers, but the claim's own upsert must not
    // regress that).
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", bob.id)
      .single();
    expect(membership!.status).toBe("accepted");

    // #495: the claim advances graph_revision exactly once.
    const afterRev = await pg.query<{ graph_revision: number }>(
      "select graph_revision from expenses where id = $1",
      [expenseId],
    );
    expect(afterRev.rows[0].graph_revision).toBe(beforeRev.rows[0].graph_revision + 1);
  });

  it("is idempotent: bob re-claiming the same token returns already_claimed with no further change", async () => {
    const beforeRev = await pg.query<{ graph_revision: number }>(
      "select graph_revision from expenses where id = $1",
      [expenseId],
    );

    const bobClient = authenticateAs(bob);
    const { data, error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guestClaimToken,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ already_claimed: true });

    const { data: bobShares } = await adminClient!
      .from("expense_shares")
      .select("id")
      .eq("expense_id", expenseId)
      .eq("user_id", bob.id);
    expect(bobShares).toHaveLength(1);

    const afterRev = await pg.query<{ graph_revision: number }>(
      "select graph_revision from expenses where id = $1",
      [expenseId],
    );
    expect(afterRev.rows[0].graph_revision).toBe(beforeRev.rows[0].graph_revision);
  });
});
