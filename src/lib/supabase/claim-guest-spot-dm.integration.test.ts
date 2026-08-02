import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createTestDmGroup,
  createTestGroupWithMembers,
  createTestUsers,
  deleteTestExpenses,
  issueGuestClaimToken,
  type TestUser,
} from "@/test/integration-helpers";

// Issue #472 slice: claim_guest_spot must enforce canonical two-person DM
// membership. join_group_via_link already rejects DM targets; this test
// proves the guest-claim ingress now does the same, returning PST05 for a
// non-pair caller and a corrupt-shape PST07 when an outsider membership
// row has been seeded, and that a canonical pair member and a regular-group
// bearer still claim successfully.

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

interface GuestFixture {
  expenseId: string;
  guestId: string;
  claimToken: string;
}

async function buildGuestFixture(
  creator: TestUser,
  groupId: string,
): Promise<GuestFixture> {
  const creatorClient = authenticateAs(creator);
  const { data: saveResult, error: saveError } = await creatorClient.rpc(
    "save_expense_draft_graph",
    {
      p_expense: {
        group_id: groupId,
        title: "#472 dm-guard fixture",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 2,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      // Creator pays the whole 2 cents and takes no share; the guest owes it.
      p_shares: [{ user_id: creator.id, share_amount_cents: 0 }],
      p_payers: [{ user_id: creator.id, amount_cents: 2 }],
      p_guests: [{ local_id: "g1", display_name: "Future claimant" }],
      p_guest_shares: [{ local_id: "g1", share_amount_cents: 2 }],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    },
  );
  if (saveError || !saveResult) throw new Error(`create expense: ${saveError?.message}`);
  const saved = saveResult as { id: string; graph_revision: number };

  const { data: guest, error: guestError } = await adminClient!
    .from("expense_guests")
    .select("id")
    .eq("expense_id", saved.id)
    .single();
  if (guestError || !guest) throw new Error(`load guest: ${guestError?.message}`);

  const { error: rpcError } = await creatorClient.rpc("activate_saved_expense", {
    p_expense_id: saved.id,
    p_expected_graph_revision: saved.graph_revision,
  });
  if (rpcError) throw new Error(`activate: ${rpcError.message}`);

  // #581: the creator issues a v1 opaque text claim credential now that the
  // expense is active (the legacy expense_guests.claim_token uuid is retired).
  const claimToken = await issueGuestClaimToken(creator, guest.id);

  return { expenseId: saved.id, guestId: guest.id, claimToken };
}

describe.skipIf(!canRun)("claim_guest_spot DM guard (#472)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  let dmGroupId: string;
  let dmFixture: GuestFixture;

  let regularGroupId: string;
  let regularFixture: GuestFixture;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();

    [alice, bob, carol] = await createTestUsers(3);
    for (const u of [alice, bob, carol]) registerTestUser(u.id);

    const dmGroup = await createTestDmGroup(alice, bob, { bothAccepted: true });
    dmGroupId = dmGroup.id;
    dmFixture = await buildGuestFixture(alice, dmGroupId);

    const regularGroup = await createTestGroupWithMembers(alice, [bob]);
    regularGroupId = regularGroup.id;
    regularFixture = await buildGuestFixture(alice, regularGroupId);
  });

  afterAll(async () => {
    if (pg) {
      const ids = [dmFixture?.expenseId, regularFixture?.expenseId].filter(
        Boolean,
      ) as string[];
      if (ids.length > 0) await deleteTestExpenses(pg, ids);
      await pg.end();
    }
  });

  async function graphRevision(expenseId: string): Promise<number> {
    const { data, error } = await adminClient!
      .from("expenses")
      .select("graph_revision")
      .eq("id", expenseId)
      .single();
    if (error || !data) throw new Error(`load revision: ${error?.message}`);
    return (data as { graph_revision: number }).graph_revision;
  }

  it("denies a non-pair caller on a DM group with PST05 and mutates nothing", async () => {
    const before = await graphRevision(dmFixture.expenseId);
    const carolClient = authenticateAs(carol);

    const { error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: dmFixture.claimToken,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PST05");

    // Guest unchanged.
    const { data: guest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("id", dmFixture.guestId)
      .single();
    expect((guest as { claimed_by: string | null }).claimed_by).toBeNull();

    // No membership, share, or balance for carol in the DM group.
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("id")
      .eq("group_id", dmGroupId)
      .eq("user_id", carol.id);
    expect(membership ?? []).toEqual([]);

    const { data: share } = await adminClient!
      .from("expense_shares")
      .select("id")
      .eq("expense_id", dmFixture.expenseId)
      .eq("user_id", carol.id);
    expect(share ?? []).toEqual([]);

    const { data: balance } = await adminClient!
      .from("balances")
      .select("id")
      .eq("group_id", dmGroupId)
      .or(`user_a.eq.${carol.id},user_b.eq.${carol.id}`);
    expect(balance ?? []).toEqual([]);


    // graph_revision untouched.
    expect(await graphRevision(dmFixture.expenseId)).toBe(before);

    // The guest share row still exists (claim did not consume it).
    const { data: guestShare } = await adminClient!
      .from("expense_guest_shares")
      .select("id")
      .eq("guest_id", dmFixture.guestId);
    expect((guestShare ?? []).length).toBeGreaterThan(0);
  });

  it("still rejects when an outsider accepted membership row has been seeded (PST07)", async () => {
    // Seed an accepted outsider membership for carol into the DM group,
    // bypassing the membership guard and the deferred DM-shape constraint
    // triggers (both reject a non-pair DM member). Done as the owner over a
    // direct pg connection with session_replication_role = replica so the
    // triggers are suppressed within this transaction only.
    await pg.query("BEGIN");
    await pg.query("SET LOCAL session_replication_role = replica");
    await pg.query(
      `INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
       VALUES ($1, $2, 'accepted', $3, now())
       ON CONFLICT (group_id, user_id) DO UPDATE
         SET status = 'accepted', accepted_at = now()`,
      [dmGroupId, carol.id, alice.id],
    );
    await pg.query("COMMIT");

    try {
      const before = await graphRevision(dmFixture.expenseId);
      const carolClient = authenticateAs(carol);

      const { error } = await carolClient.rpc("claim_guest_spot", {
        p_claim_token: dmFixture.claimToken,
      });

      // The seeded outsider row makes the persisted shape corrupt, so
      // assert_dm_group_shape raises PST07 (which takes precedence over the
      // actor PST05 per #472's error precedence). The claim is denied and
      // nothing mutates.
      expect(error).not.toBeNull();
      expect(error!.code).toBe("PST07");
      expect(await graphRevision(dmFixture.expenseId)).toBe(before);

      const { data: guest } = await adminClient!
        .from("expense_guests")
        .select("claimed_by")
        .eq("id", dmFixture.guestId)
        .single();
      expect((guest as { claimed_by: string | null }).claimed_by).toBeNull();
    } finally {
      // Restore canonical shape so teardown/other tests see a clean DM.
      await pg.query(
        "DELETE FROM public.group_members WHERE group_id = $1 AND user_id = $2",
        [dmGroupId, carol.id],
      );
    }
  });

  it("lets a canonical pair member claim on a DM group", async () => {
    const bobClient = authenticateAs(bob);

    const { data, error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: dmFixture.claimToken,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_id: dmFixture.guestId,
      expense_id: dmFixture.expenseId,
      already_claimed: false,
    });

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by")
      .eq("id", dmFixture.guestId)
      .single();
    expect((guest as { claimed_by: string | null }).claimed_by).toBe(bob.id);
  });

  it("preserves the regular-group bearer flow for a non-member claimant", async () => {
    // Carol is not a member of this regular group; the guest-claim bearer
    // token is the intended invitation path. She claims and is accepted.
    const carolClient = authenticateAs(carol);

    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: regularFixture.claimToken,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ already_claimed: false });

    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", regularGroupId)
      .eq("user_id", carol.id)
      .single();
    expect((membership as { status: string }).status).toBe("accepted");
  });
});
