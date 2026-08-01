import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createTestGroupWithMembers,
  createTestUsers,
  deleteTestExpenses,
  issueGuestClaimToken,
  type TestUser,
} from "@/test/integration-helpers";

// Issue #581: opaque, creator-issued guest-claim credentials. The plaintext,
// group-readable expense_guests.claim_token is gone from the claim path: a
// usable token exists only after the creator explicitly issues one, is
// delivered only in the issuer response, and is stored only as a digest in
// the non-exposed guest_credentials schema. These tests prove the
// confidentiality boundary and the issue/rotate/claim contract.

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

const TOKEN_RE = /^gst1_[A-Za-z0-9_-]{43}$/;

interface GuestExpense {
  expenseId: string;
  guestId: string;
}

async function createActiveGuestExpense(
  creator: TestUser,
  groupId: string,
  title: string,
): Promise<GuestExpense> {
  const client = authenticateAs(creator);
  const { data: saveResult, error: saveError } = await client.rpc(
    "save_expense_draft_graph",
    {
      p_expense: {
        group_id: groupId,
        title,
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 2,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
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

  const { data: guest } = await adminClient!
    .from("expense_guests")
    .select("id")
    .eq("expense_id", saved.id)
    .single();
  if (!guest) throw new Error("guest not created");

  const { error: actError } = await client.rpc("activate_saved_expense", {
    p_expense_id: saved.id,
    p_expected_graph_revision: saved.graph_revision,
  });
  if (actError) throw new Error(`activate: ${actError.message}`);

  return { expenseId: saved.id, guestId: (guest as { id: string }).id };
}

async function credRow(pg: Client, guestId: string) {
  const { rows } = await pg.query(
    "SELECT token_generation, token_version, octet_length(token_digest) AS digest_len, issued_at::text AS issued_at FROM guest_credentials.expense_guest_claim_tokens WHERE guest_id = $1",
    [guestId],
  );
  return rows[0] as
    | {
        token_generation: number;
        token_version: number;
        digest_len: number;
        issued_at: string;
      }
    | undefined;
}

describe.skipIf(!canRun)("guest-claim credentials (#581)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  const expenseIds: string[] = [];

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();

    [alice, bob, carol] = await createTestUsers(3);
    for (const u of [alice, bob, carol]) registerTestUser(u.id);

    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  afterAll(async () => {
    if (pg) {
      if (expenseIds.length > 0) await deleteTestExpenses(pg, expenseIds);
      await pg.end();
    }
  });

  async function newGuestExpense(title: string): Promise<GuestExpense> {
    const fx = await createActiveGuestExpense(alice, groupId, title);
    expenseIds.push(fx.expenseId);
    return fx;
  }

  it("creator issues a valid v1 token at generation 1, absent from expense rows", async () => {
    const fx = await newGuestExpense("#581 issue");
    const token = await issueGuestClaimToken(alice, fx.guestId);

    expect(token).toMatch(TOKEN_RE);
    expect(token).toHaveLength(48);

    const row = await credRow(pg, fx.guestId);
    expect(row?.token_generation).toBe(1);
    expect(row?.token_version).toBe(1);
    expect(row?.digest_len).toBe(32);

    // No expense_guests field equals the raw token.
    const { data: guests } = await adminClient!
      .from("expense_guests")
      .select("*")
      .eq("id", fx.guestId)
      .single();
    const flat = JSON.stringify(guests);
    expect(flat).not.toContain(token);
  });

  it("non-creators cannot issue", async () => {
    const fx = await newGuestExpense("#581 non-creator issue");

    const bobClient = authenticateAs(bob);
    const { error: bobErr } = await bobClient.rpc("issue_guest_claim_token", {
      p_guest_id: fx.guestId,
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(bobErr?.code).toBe("PST05");

    const carolClient = authenticateAs(carol);
    const { error: carolErr } = await carolClient.rpc("issue_guest_claim_token", {
      p_guest_id: fx.guestId,
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(["PST05", "PST08"]).toContain(carolErr?.code);

    // No credential row was created by the failed attempts.
    expect(await credRow(pg, fx.guestId)).toBeUndefined();
  });

  it("repeated initial issue is non-revealing: {exists, generation}", async () => {
    const fx = await newGuestExpense("#581 replay");
    const first = await issueGuestClaimToken(alice, fx.guestId);
    const before = await credRow(pg, fx.guestId);

    const aliceClient = authenticateAs(alice);
    const { data, error } = await aliceClient.rpc("issue_guest_claim_token", {
      p_guest_id: fx.guestId,
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "exists", generation: 1 });

    const after = await credRow(pg, fx.guestId);
    expect(after?.issued_at).toBe(before?.issued_at);
    // The original token still resolves.
    const { data: resolved } = await adminClient!
      .rpc("resolve_guest_claim_token", { p_claim_token: first })
      .then((r) => r as { data: unknown[] | null });
    expect((resolved ?? []).length).toBe(1);
  });

  it("rotate invalidates the prior token; the new one claims", async () => {
    const fx = await newGuestExpense("#581 rotate");
    const gen1 = await issueGuestClaimToken(alice, fx.guestId);

    const aliceClient = authenticateAs(alice);
    const { data: rotData, error: rotErr } = await aliceClient.rpc(
      "issue_guest_claim_token",
      {
        p_guest_id: fx.guestId,
        p_rotate: true,
        p_expected_generation: 1,
      },
    );
    expect(rotErr).toBeNull();
    const rot = rotData as { outcome: string; token: string; generation: number };
    expect(rot.outcome).toBe("issued");
    expect(rot.generation).toBe(2);
    expect(rot.token).not.toBe(gen1);

    expect((await credRow(pg, fx.guestId))?.token_generation).toBe(2);

    // gen1 no longer resolves and cannot claim.
    const { data: r1 } = await adminClient!
      .rpc("resolve_guest_claim_token", { p_claim_token: gen1 })
      .then((r) => r as { data: unknown[] | null });
    expect((r1 ?? []).length).toBe(0);

    const carolClient = authenticateAs(carol);
    const { error: claimOld } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: gen1,
    });
    expect(claimOld?.code).toBe("PST05");

    // gen2 claims successfully (regular-group bearer flow).
    const { data: claimNew, error: claimNewErr } = await carolClient.rpc(
      "claim_guest_spot",
      { p_claim_token: rot.token },
    );
    expect(claimNewErr).toBeNull();
    expect(claimNew).toMatchObject({ already_claimed: false });
  });

  it("rotate with a stale generation is PST08 and changes nothing", async () => {
    const fx = await newGuestExpense("#581 stale rotate");
    await issueGuestClaimToken(alice, fx.guestId);
    // Credential is at generation 1. A rotate naming a generation that does
    // not match is a compare-and-swap failure -> PST08, zero writes.
    const aliceClient = authenticateAs(alice);
    const { error } = await aliceClient.rpc("issue_guest_claim_token", {
      p_guest_id: fx.guestId,
      p_rotate: true,
      p_expected_generation: 999,
    });
    expect(error?.code).toBe("PST08");
    expect((await credRow(pg, fx.guestId))?.token_generation).toBe(1);
  });

  it("rejects invalid mode combinations and malformed guest id", async () => {
    const fx = await newGuestExpense("#581 invalid modes");
    const aliceClient = authenticateAs(alice);

    const cases: Array<{ rotate: boolean | null; gen: number | null }> = [
      { rotate: null, gen: null },
      { rotate: false, gen: 1 },
      { rotate: true, gen: null },
      { rotate: true, gen: 0 },
    ];
    for (const c of cases) {
      const { error } = await aliceClient.rpc("issue_guest_claim_token", {
        p_guest_id: fx.guestId,
        p_rotate: c.rotate as unknown as boolean,
        p_expected_generation: c.gen as unknown as number,
      });
      expect(error?.code).toBe("PST02");
    }

    // Malformed guest id UUID wire text -> 22P02 before entry.
    const { error: badId } = await aliceClient.rpc("issue_guest_claim_token", {
      p_guest_id: "not-a-uuid",
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(badId?.code).toBe("22P02");
  });

  it("claim with an unknown or malformed token mutates nothing", async () => {
    const fx = await newGuestExpense("#581 bad claim");
    const carolClient = authenticateAs(carol);
    const before = await credRow(pg, fx.guestId);

    const unknown = "gst1_" + "A".repeat(43);
    const { error: unkErr } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: unknown,
    });
    expect(unkErr?.code).toBe("PST05");

    const { error: uuidErr } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(uuidErr?.code).toBe("PST02");

    // Nothing changed.
    expect(await credRow(pg, fx.guestId)).toBeUndefined();
    const { data: guest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by")
      .eq("id", fx.guestId)
      .single();
    expect((guest as { claimed_by: string | null }).claimed_by).toBeNull();
    void before;
  });

  it("resolve_guest_claim_token is service-only and non-disclosing", async () => {
    const fx = await newGuestExpense("#581 resolve");
    const token = await issueGuestClaimToken(alice, fx.guestId);

    // Service role resolves exactly the three IDs.
    const { data: ok } = await adminClient!
      .rpc("resolve_guest_claim_token", { p_claim_token: token })
      .then((r) => r as { data: unknown[] | null; error: unknown });
    expect((ok ?? []).length).toBe(1);
    expect(ok![0]).toMatchObject({ guest_id: fx.guestId, expense_id: fx.expenseId });

    // Authenticated cannot call it.
    const aliceClient = authenticateAs(alice);
    const { error: authErr } = await aliceClient.rpc("resolve_guest_claim_token", {
      p_claim_token: token,
    });
    expect(authErr?.code).toBe("42501");

    // Malformed / uuid / unknown all return empty (no error to the caller).
    for (const bad of [
      "not-a-token",
      "550e8400-e29b-41d4-a716-446655440000",
      "gst1_" + "A".repeat(43),
    ]) {
      const { data: empty } = await adminClient!
        .rpc("resolve_guest_claim_token", { p_claim_token: bad })
        .then((r) => r as { data: unknown[] | null });
      expect((empty ?? []).length).toBe(0);
    }
  });

  it("the credential table is inaccessible to service_role", async () => {
    // service_role has no USAGE on guest_credentials and no table privileges.
    let threw = false;
    try {
      await pg.query("SET ROLE service_role");
      await pg.query("SELECT * FROM guest_credentials.expense_guest_claim_tokens LIMIT 1");
    } catch {
      threw = true;
    } finally {
      await pg.query("RESET ROLE");
    }
    expect(threw).toBe(true);
  });

  it("refuses to issue on a draft or an already-claimed guest", async () => {
    // Draft expense: issue requires status='active'.
    const aliceClient = authenticateAs(alice);
    const { data: draftSave } = await aliceClient.rpc("save_expense_draft_graph", {
      p_expense: {
        group_id: groupId,
        title: "#581 draft issue",
        merchant_name: null,
        expense_type: "single_amount",
        total_amount: 2,
        service_fee_basis_points: 0,
        fixed_fees: 0,
      },
      p_items: [],
      p_shares: [{ user_id: alice.id, share_amount_cents: 0 }],
      p_payers: [{ user_id: alice.id, amount_cents: 2 }],
      p_guests: [{ local_id: "g1", display_name: "Draft guest" }],
      p_guest_shares: [{ local_id: "g1", share_amount_cents: 2 }],
      p_participant_order: [],
      p_expected_graph_revision: 0,
      p_save_operation_id: crypto.randomUUID(),
    });
    const draft = draftSave as { id: string };
    expenseIds.push(draft.id);
    const { data: draftGuest } = await adminClient!
      .from("expense_guests")
      .select("id")
      .eq("expense_id", draft.id)
      .single();
    const { error: draftErr } = await aliceClient.rpc("issue_guest_claim_token", {
      p_guest_id: (draftGuest as { id: string }).id,
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(draftErr?.code).toBe("PST05");

    // Claimed guest: issue returns PST08.
    const fx = await newGuestExpense("#581 claimed issue");
    const token = await issueGuestClaimToken(alice, fx.guestId);
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", { p_claim_token: token });

    const { error: claimedErr } = await aliceClient.rpc("issue_guest_claim_token", {
      p_guest_id: fx.guestId,
      p_rotate: false,
      p_expected_generation: null as unknown as number,
    });
    expect(claimedErr?.code).toBe("PST08");
  });
});
