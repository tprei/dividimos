import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  createExpense,
  getBalances,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface GuestClaimResolve {
  guestId: string | null;
  displayName: string | null;
  expenseTitle: string | null;
  groupName: string | null;
  shareCents: number | null;
  status: "ready" | "already_claimed" | "not_found";
}

interface ClaimAck {
  expenseId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface IssuedToken {
  token: string;
  expiresAt: string;
}

interface EditAck {
  expenseId: string;
  groupId: string;
  versionNo: number;
  ledgerVersion: number;
  eventId: number | null;
}

interface PayloadParticipant {
  kind: "user" | "guest";
  userId?: string;
  guestId?: string | null;
  displayName?: string;
}

interface ExpenseDetail {
  current: { payload: { participants: PayloadParticipant[] } };
  participants: Array<{
    participantIndex: number;
    kind: "user" | "guest";
    shareCents: number;
    paidCents: number;
    user: { id: string } | null;
    guest: {
      id: string;
      displayName: string;
      claimedBy: string | null;
      claimLinkGeneration: number;
    } | null;
  }>;
}

interface BootstrapPayload {
  groups: Array<{ group: { id: string } }>;
}

async function rpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as {
    data: T | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`RPC ${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function getExpenseDetail(
  client: SupabaseClient,
  expenseId: string,
): Promise<ExpenseDetail> {
  return rpc<ExpenseDetail>(client, "get_expense", { p_expense_id: expenseId });
}

describe.skipIf(!isIntegrationTestReady)(
  "Phase 1 ledger guest claim RPCs integration tests",
  () => {
    let payer: TestUser; // A: group creator, pays the whole expense
    let member: TestUser; // B: accepted member, can issue claim tokens
    let outsider: TestUser; // C: not in the group, claims the guest

    let payerClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let outsiderClient: SupabaseClient;
    let anonClient: SupabaseClient;

    let groupId: string;
    let expenseId: string;
    let guestId: string;

    let initialToken: string; // issued first, invalidated by rotation
    let rotatedToken: string; // current token, used by C to claim

    beforeAll(async () => {
      const users = await createTestUsers(3);
      [payer, member, outsider] = users;

      payerClient = authenticateAs(payer);
      memberClient = authenticateAs(member);
      outsiderClient = authenticateAs(outsider);
      anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      groupId = await createGroupWithMembers(
        payer,
        [member],
        "Grupo hóspedes",
      );

      const created = await createExpense(payer, {
        groupId,
        title: "Churrasco de sábado",
        totalCents: 9000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "user", userId: member.id },
            { kind: "guest", guestId: null, displayName: "Zé" },
          ],
          shares: [3000, 3000, 3000],
          payers: [{ participantIndex: 0, amountCents: 9000 }],
          itemAssignments: null,
        },
      });
      expenseId = created.expenseId;

      const detail = await getExpenseDetail(payerClient, expenseId);
      const guestParticipant = detail.current.payload.participants[2];
      if (
        !guestParticipant ||
        guestParticipant.kind !== "guest" ||
        !guestParticipant.guestId
      ) {
        throw new Error("Fixture failure: guest participant was not materialized");
      }
      guestId = guestParticipant.guestId;
    });

    it("records the unclaimed guest as a balance row tied to the payload guest id", async () => {
      const balances = await getBalances(groupId);
      const guestRows = balances.filter((row) => row.kind === "guest");
      expect(guestRows).toHaveLength(1);
      expect(guestRows[0].net_cents).toBe(-3000);

      const detail = await getExpenseDetail(payerClient, expenseId);
      const payloadGuest = detail.current.payload.participants[2];
      expect(payloadGuest?.kind).toBe("guest");
      expect(payloadGuest?.guestId).toBe(guestRows[0].participant_id);
      expect(payloadGuest?.displayName).toBe("Zé");
    });

    it("lets any accepted member issue a claim token with an expiry", async () => {
      const issuedToken = await rpc<IssuedToken>(memberClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      expect(Object.keys(issuedToken).sort()).toEqual(["expiresAt", "token"]);
      expect(issuedToken.token.length).toBeGreaterThanOrEqual(40); // 32 random bytes, base64url
      expect(issuedToken.token).toMatch(/^[A-Za-z0-9_-]+$/);
      const ttlMs = Date.parse(issuedToken.expiresAt) - Date.now();
      expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
      initialToken = issuedToken.token;

      const issued = await getExpenseDetail(payerClient, expenseId);
      expect(issued.participants[2]?.guest?.claimLinkGeneration).toBe(1);
    });

    it("refuses token issuance by a non-member with not_a_member", async () => {
      const code = await expectRpcError(
        Promise.resolve(
          outsiderClient.rpc("create_guest_claim_token", { p_guest_id: guestId }),
        ),
      );
      expect(code).toBe("not_a_member");
    });

    it("lets the anon client resolve the token with the guest details", async () => {
      const resolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: initialToken },
      );
      expect(Object.keys(resolved).sort()).toEqual(
        [
          "displayName",
          "expenseTitle",
          "groupName",
          "guestId",
          "shareCents",
          "status",
        ].sort(),
      );
      expect(resolved.status).toBe("ready");
      expect(resolved.guestId).toBe(guestId);
      expect(resolved.displayName).toBe("Zé");
      expect(resolved.shareCents).toBe(3000);
      expect(resolved.expenseTitle).toBe("Churrasco de sábado");
      expect(resolved.groupName).toBe("Grupo hóspedes");
    });

    it("rotates the token on the first replacement: old resolves not_found, new resolves ready", async () => {
      const issuedToken = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      rotatedToken = issuedToken.token;
      expect(rotatedToken).not.toBe(initialToken);

      const oldResolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: initialToken },
      );
      expect(oldResolved.status).toBe("not_found");
      expect(oldResolved.guestId).toBeNull();

      const newResolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: rotatedToken },
      );
      expect(newResolved.status).toBe("ready");
      expect(newResolved.guestId).toBe(guestId);

      const rotated = await getExpenseDetail(payerClient, expenseId);
      expect(rotated.participants[2]?.guest?.claimLinkGeneration).toBe(2);
    });

    it("keeps rotating past the second issue: rotation is the safety valve", async () => {
      const issuedToken = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      const superseded = rotatedToken;
      rotatedToken = issuedToken.token;
      expect(rotatedToken).not.toBe(superseded);

      const oldResolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: superseded },
      );
      expect(oldResolved.status).toBe("not_found");

      const detail = await getExpenseDetail(payerClient, expenseId);
      expect(detail.participants[2]?.guest?.claimLinkGeneration).toBe(3);
    });

    it("treats an expired token as unknown for both resolve and claim", async () => {
      await withPg(async (pg) => {
        await pg.query(
          "update guest_credentials.claim_tokens set expires_at = now() - interval '1 second' where guest_id = $1",
          [guestId],
        );
      });

      const resolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: rotatedToken },
      );
      expect(resolved.status).toBe("not_found");
      expect(resolved.guestId).toBeNull();

      const code = await expectRpcError(
        Promise.resolve(outsiderClient.rpc("claim_guest", { p_token: rotatedToken })),
      );
      expect(code).toBe("invalid_token");

      const reissued = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      rotatedToken = reissued.token;
    });

    it("revokes the current token: it stops resolving and cannot be claimed", async () => {
      const revoked = await rpc<{ guestId: string }>(
        memberClient,
        "revoke_guest_claim_token",
        { p_guest_id: guestId },
      );
      expect(revoked.guestId).toBe(guestId);

      const resolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: rotatedToken },
      );
      expect(resolved.status).toBe("not_found");

      const code = await expectRpcError(
        Promise.resolve(outsiderClient.rpc("claim_guest", { p_token: rotatedToken })),
      );
      expect(code).toBe("invalid_token");

      const detail = await getExpenseDetail(payerClient, expenseId);
      expect(detail.participants[2]?.guest?.claimLinkGeneration).toBe(0);

      const secondRevoke = await rpc<{ guestId: string }>(
        memberClient,
        "revoke_guest_claim_token",
        { p_guest_id: guestId },
      );
      expect(secondRevoke.guestId).toBe(guestId);
    });

    it("refuses revocation by a non-member with not_a_member", async () => {
      const code = await expectRpcError(
        Promise.resolve(
          outsiderClient.rpc("revoke_guest_claim_token", { p_guest_id: guestId }),
        ),
      );
      expect(code).toBe("not_a_member");
    });

    it("claims the guest with a freshly issued token", async () => {
      const issuedToken = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guestId,
      });
      rotatedToken = issuedToken.token;

      const stillCurrent = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: rotatedToken },
      );
      expect(stillCurrent.status).toBe("ready");
      expect(stillCurrent.guestId).toBe(guestId);
    });

    it("claims the guest as a new member and returns the mutation ack", async () => {
      const ack = await rpc<ClaimAck>(outsiderClient, "claim_guest", {
        p_token: rotatedToken,
      });
      expect(Object.keys(ack).sort()).toEqual(
        ["eventId", "expenseId", "groupId", "ledgerVersion"].sort(),
      );
      expect(ack.expenseId).toBe(expenseId);
      expect(ack.groupId).toBe(groupId);
      expect(typeof ack.ledgerVersion).toBe("number");
      expect(ack.eventId).not.toBeNull();
    });

    it("moves the guest debt to the claimer and drops the guest balance row", async () => {
      const balances = await getBalances(groupId);
      expect(balances.filter((row) => row.kind === "guest")).toHaveLength(0);

      const netOf = (userId: string): number | undefined =>
        balances.find(
          (row) => row.kind === "user" && row.participant_id === userId,
        )?.net_cents;
      expect(netOf(outsider.id)).toBe(-3000);
      expect(netOf(payer.id)).toBe(6000);
      expect(netOf(member.id)).toBe(-3000);
      expect(balances.reduce((sum, row) => sum + row.net_cents, 0)).toBe(0);
    });

    it("shows the claimed participant as a user in get_expense", async () => {
      const detail = await getExpenseDetail(memberClient, expenseId);
      const claimed = detail.participants.find(
        (p) => p.participantIndex === 2,
      );
      expect(claimed?.kind).toBe("user");
      expect(claimed?.user?.id).toBe(outsider.id);
      expect(claimed?.guest).toBeNull();

      const payloadGuest = detail.current.payload.participants[2];
      expect(payloadGuest?.kind).toBe("user");
      expect(payloadGuest?.userId).toBe(outsider.id);
    });

    it("adds the claimer to the group bootstrap", async () => {
      const bootstrap = await rpc<BootstrapPayload>(
        outsiderClient,
        "bootstrap",
      );
      expect(bootstrap.groups.map((g) => g.group.id)).toContain(groupId);
    });

    it("resolves the claimed token with status already_claimed", async () => {
      const resolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: rotatedToken },
      );
      expect(resolved.status).toBe("already_claimed");
      expect(resolved.guestId).toBe(guestId);
    });

    it("rejects a claim replay with already_claimed", async () => {
      const code = await expectRpcError(
        Promise.resolve(
          outsiderClient.rpc("claim_guest", { p_token: rotatedToken }),
        ),
      );
      expect(code).toBe("already_claimed");
    });

    it("rejects a garbage token with invalid_token (claim) and not_found (resolve)", async () => {
      const garbage = `garbage-${crypto.randomUUID()}`;
      const claimCode = await expectRpcError(
        Promise.resolve(
          outsiderClient.rpc("claim_guest", { p_token: garbage }),
        ),
      );
      expect(claimCode).toBe("invalid_token");

      const resolved = await rpc<GuestClaimResolve>(
        anonClient,
        "resolve_guest_claim_token",
        { p_token: garbage },
      );
      expect(resolved.status).toBe("not_found");
      expect(resolved.guestId).toBeNull();
    });

    it("rejects a claim by an existing participant of the same expense with already_participant", async () => {
      // Second expense where A participates alongside a fresh guest. Shares
      // [2000, 0] keep every per-participant delta at zero so group balances
      // stay untouched for the edit test below.
      const created = await createExpense(payer, {
        groupId,
        title: "Trilha do guest dois",
        totalCents: 2000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "guest", guestId: null, displayName: "Zé 2" },
          ],
          shares: [2000, 0],
          payers: [{ participantIndex: 0, amountCents: 2000 }],
          itemAssignments: null,
        },
      });

      const detail = await getExpenseDetail(payerClient, created.expenseId);
      const guestParticipant = detail.current.payload.participants.find(
        (p) => p.kind === "guest",
      );
      if (!guestParticipant?.guestId) {
        throw new Error("Fixture failure: second guest was not materialized");
      }

      const issuedToken = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guestParticipant.guestId,
      });
      const code = await expectRpcError(
        Promise.resolve(payerClient.rpc("claim_guest", { p_token: issuedToken.token })),
      );
      expect(code).toBe("already_participant");
    });

    it("edits the claimed expense keeping the claimer as a user participant with consistent nets", async () => {
      const ack = await rpc<EditAck>(payerClient, "edit_expense", {
        p_expense_id: expenseId,
        p_expected_version_no: 1, // claim_guest rewrote the payload in place, no version bump
        p_occurred_on: new Date().toISOString().slice(0, 10),
        p_title: "Churrasco de sábado",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 9000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "user", userId: member.id },
            { kind: "user", userId: outsider.id },
          ],
          shares: [3000, 3000, 3000],
          payers: [{ participantIndex: 0, amountCents: 9000 }],
          itemAssignments: null,
        },
      });
      expect(ack.expenseId).toBe(expenseId);
      expect(ack.versionNo).toBe(2);

      const balances = await getBalances(groupId);
      expect(balances.filter((row) => row.kind === "guest")).toHaveLength(0);

      const netOf = (userId: string): number | undefined =>
        balances.find(
          (row) => row.kind === "user" && row.participant_id === userId,
        )?.net_cents;
      expect(netOf(payer.id)).toBe(6000);
      expect(netOf(member.id)).toBe(-3000);
      expect(netOf(outsider.id)).toBe(-3000);
      expect(balances.reduce((sum, row) => sum + row.net_cents, 0)).toBe(0);
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "orphaned guest claim tokens cannot grant membership",
  () => {
    let payer: TestUser;
    let member: TestUser;
    let stranger: TestUser;
    let payerClient: SupabaseClient;
    let strangerClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let groupId: string;
    let guestId: string;
    let token: string;

    beforeAll(async () => {
      [payer, member, stranger] = await createTestUsers(3);
      payerClient = authenticateAs(payer);
      strangerClient = authenticateAs(stranger);
      anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      groupId = await createGroupWithMembers(payer, [member], "Grupo órfãos");
      const created = await createExpense(payer, {
        groupId,
        title: "Convidado depois removido",
        totalCents: 6000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "user", userId: member.id },
            { kind: "guest", guestId: null, displayName: "Zé órfão" },
          ],
          shares: [2000, 2000, 2000],
          payers: [{ participantIndex: 0, amountCents: 6000 }],
          itemAssignments: null,
        },
      });

      const detail = await getExpenseDetail(payerClient, created.expenseId);
      const guestParticipant = detail.current.payload.participants[2];
      if (
        !guestParticipant ||
        guestParticipant.kind !== "guest" ||
        !guestParticipant.guestId
      ) {
        throw new Error("Fixture failure: guest was not materialized");
      }
      guestId = guestParticipant.guestId;

      token = (
        await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
          p_guest_id: guestId,
        })
      ).token;

      const ack = await rpc<EditAck>(payerClient, "edit_expense", {
        p_expense_id: created.expenseId,
        p_expected_version_no: 1,
        p_occurred_on: new Date().toISOString().slice(0, 10),
        p_title: "Convidado depois removido",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 6000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "user", userId: member.id },
          ],
          shares: [3000, 3000],
          payers: [{ participantIndex: 0, amountCents: 6000 }],
          itemAssignments: null,
        },
      });
      expect(ack.versionNo).toBe(2);
    });

    it("drops the unclaimed guest, its claim token, and stops resolving the token", async () => {
      const counts = await withPg(async (client) => {
        const guests = await client.query<{ count: number }>(
          "select count(*)::int as count from public.guests where id = $1",
          [guestId],
        );
        const tokens = await client.query<{ count: number }>(
          "select count(*)::int as count from guest_credentials.claim_tokens " +
            "where token_digest = extensions.digest(convert_to($1, 'utf8'), 'sha256')",
          [token],
        );
        return { guests: guests.rows[0]?.count ?? 0, tokens: tokens.rows[0]?.count ?? 0 };
      });
      expect(counts.guests).toBe(0);
      expect(counts.tokens).toBe(0);

      const resolved = await rpc<GuestClaimResolve>(anonClient, "resolve_guest_claim_token", {
        p_token: token,
      });
      expect(resolved.status).toBe("not_found");
      expect(resolved.guestId).toBeNull();
    });

    it("rejects claiming the orphaned token with invalid_token and no membership appears", async () => {
      const code = await expectRpcError(
        Promise.resolve(strangerClient.rpc("claim_guest", { p_token: token })),
      );
      expect(code).toBe("invalid_token");

      const memberCount = await withPg(async (client) => {
        const memberships = await client.query<{ count: number }>(
          "select count(*)::int as count from public.group_members " +
            "where group_id = $1 and user_id = $2",
          [groupId, stranger.id],
        );
        return memberships.rows[0]?.count ?? 0;
      });
      expect(memberCount).toBe(0);

      const balances = await getBalances(groupId);
      expect(balances.filter((row) => row.kind === "guest")).toHaveLength(0);
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "a guest on an expense invalidated by a decline",
  () => {
    it("cannot be claimed once the decline clears the expense participants", async () => {
      const [payer, invitee, stranger] = await createTestUsers(3);
      const payerClient = authenticateAs(payer);
      const { groupId } = await createGroup(payer, "Recusa com convidado", [invitee.id]);

      const created = await createExpense(payer, {
        groupId,
        title: "Rodízio",
        totalCents: 6000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: payer.id },
            { kind: "user", userId: invitee.id },
            { kind: "guest", guestId: null, displayName: "Convidada" },
          ],
          shares: [2000, 2000, 2000],
          payers: [{ participantIndex: 0, amountCents: 6000 }],
          itemAssignments: null,
        },
      });

      const detail = await getExpenseDetail(payerClient, created.expenseId);
      const guest = detail.current.payload.participants[2];
      if (guest.kind !== "guest" || !guest.guestId) {
        throw new Error("Fixture failure: guest was not materialized");
      }
      const issued = await rpc<IssuedToken>(payerClient, "create_guest_claim_token", {
        p_guest_id: guest.guestId,
      });
      const token = issued.token;

      await rpc(authenticateAs(invitee), "decline_invitation", { p_group_id: groupId });

      const code = await expectRpcError(
        Promise.resolve(authenticateAs(stranger).rpc("claim_guest", { p_token: token })),
      );
      expect(code).toBe("expense_deleted");

      const memberCount = await withPg(async (client) => {
        const rows = await client.query<{ count: number }>(
          "select count(*)::int as count from public.group_members " +
            "where group_id = $1 and user_id = $2",
          [groupId, stranger.id],
        );
        return rows.rows[0]?.count ?? 0;
      });
      expect(memberCount).toBe(0);
    });
  },
);
