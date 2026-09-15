import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady, untrackTestGroup } from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  acceptInvitation,
  createExpense,
  equalSplitPayload,
  getBalances,
  withPg,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
}

interface MeProfile extends UserProfile {
  email: string;
  pixKeyType: string | null;
  pixKeyHint: string | null;
  onboarded: boolean;
  notificationPreferences: Record<string, unknown> | null;
}

interface GroupMember {
  groupId: string;
  userId: string;
  status: "invited" | "accepted";
  invitedBy: string | null;
  acceptedAt: string | null;
  user: UserProfile;
}

interface GroupInfo {
  id: string;
  kind: "group" | "dm";
  name: string;
  creatorId: string;
  dmUserA: string | null;
  dmUserB: string | null;
  ledgerVersion: number;
  createdAt: string;
}

interface GroupSnapshot {
  group: GroupInfo;
  members: GroupMember[];
  balances: Array<{ kind: string; participantId: string; netCents: number }>;
  settlements: unknown[];
  recentExpenses: unknown[];
  lastEventId: number;
  unreadCount: number;
  lastMessage: unknown | null;
  lastActivityAt: string;
  expenseCount: number;
}

interface BootstrapPayload {
  me: MeProfile;
  groups: GroupSnapshot[];
  serverTime: string;
}

interface MutationAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
}

interface SettlementAck {
  settlementId: string;
  groupId: string;
  ledgerVersion: number;
  eventId: number;
}

interface DmAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
  created: boolean;
}

interface InviteLinkAck {
  groupId: string;
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

interface InviteLinkPreview {
  groupName: string | null;
  memberCount: number | null;
  creatorName: string | null;
  valid: boolean;
}

interface ActivityEvent {
  id: number;
  groupId: string;
  actorId: string;
  kind: string;
  expenseId: string | null;
  settlementId: string | null;
  subjectUserId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
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

async function expectError(
  call: PromiseLike<{ error: { message: string } | null }>,
): Promise<string> {
  return expectRpcError(Promise.resolve(call));
}

describe.skipIf(!isIntegrationTestReady)(
  "Phase 1 ledger group RPCs integration tests",
  () => {
    let u1: TestUser;
    let u2: TestUser;
    let u3: TestUser;
    let u4: TestUser;
    let u5: TestUser;
    let u6: TestUser;
    let u7: TestUser;

    let c1: SupabaseClient;
    let c2: SupabaseClient;
    let c3: SupabaseClient;
    let c5: SupabaseClient;
    let c6: SupabaseClient;
    let c7: SupabaseClient;
    let anonClient: SupabaseClient;

    beforeAll(async () => {
      const users = await createTestUsers(7);
      [u1, u2, u3, u4, u5, u6, u7] = users;

      c1 = authenticateAs(u1);
      c2 = authenticateAs(u2);
      c3 = authenticateAs(u3);
      c5 = authenticateAs(u5);
      c6 = authenticateAs(u6);
      c7 = authenticateAs(u7);

      anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    });

    describe("group creation, invitation, and membership lifecycle", () => {
      it("fails with user_not_found when creating group with a nonexistent user id", async () => {
        const fakeUserId = crypto.randomUUID();
        const err = await expectError(
          c1.rpc("create_group", {
            p_name: "Invalid Member Group",
            p_member_ids: [fakeUserId],
          }),
        );
        expect(err).toBe("user_not_found");
      });

      it("handles creation with invitees, bootstrap status, accept, decline, re-accept, and invite by member", async () => {
        const createData = await rpc<MutationAck>(c1, "create_group", {
          p_name: "Projeto Viagem",
          p_member_ids: [u2.id, u3.id],
        });
        const groupId = createData.groupId;
        expect(groupId).toBeDefined();
        expect(createData.ledgerVersion).toBeDefined();
        expect(createData.eventId).not.toBeNull();

        const snap1 = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: groupId,
        });
        expect(snap1.members).toHaveLength(3);

        const m1 = snap1.members.find((m) => m.userId === u1.id);
        const m2 = snap1.members.find((m) => m.userId === u2.id);
        const m3 = snap1.members.find((m) => m.userId === u3.id);

        expect(m1?.status).toBe("accepted");
        expect(typeof m1?.acceptedAt).toBe("string");
        expect(m2?.status).toBe("invited");
        expect(m2?.acceptedAt).toBeNull();
        expect(m2?.invitedBy).toBe(u1.id);
        expect(m3?.status).toBe("invited");
        expect(m3?.acceptedAt).toBeNull();
        expect(m3?.invitedBy).toBe(u1.id);

        const boot2 = await rpc<BootstrapPayload>(c2, "bootstrap");
        const bootGroup2 = boot2.groups.find((g) => g.group.id === groupId);
        expect(bootGroup2).toBeDefined();
        const bootMember2 = bootGroup2?.members.find((m) => m.userId === u2.id);
        expect(bootMember2?.status).toBe("invited");

        const acceptAck = await rpc<MutationAck>(c2, "accept_invitation", {
          p_group_id: groupId,
        });
        expect(acceptAck.groupId).toBe(groupId);

        const snapAfterAccept = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: groupId,
        });
        const m2AfterAccept = snapAfterAccept.members.find(
          (m) => m.userId === u2.id,
        );
        expect(m2AfterAccept?.status).toBe("accepted");
        expect(typeof m2AfterAccept?.acceptedAt).toBe("string");

        const declineAck = await rpc<MutationAck>(c3, "decline_invitation", {
          p_group_id: groupId,
        });
        expect(declineAck.groupId).toBe(groupId);

        const snapAfterDecline = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: groupId,
        });
        expect(
          snapAfterDecline.members.some((m) => m.userId === u3.id),
        ).toBe(false);

        const reAcceptErr = await expectError(
          c3.rpc("accept_invitation", { p_group_id: groupId }),
        );
        expect(reAcceptErr).toBe("not_invited");

        const inviteData = await rpc<MutationAck>(c2, "invite_member", {
          p_group_id: groupId,
          p_user_id: u4.id,
        });
        expect(inviteData.groupId).toBe(groupId);

        const snapAfterInvite = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: groupId,
        });
        const m4 = snapAfterInvite.members.find((m) => m.userId === u4.id);
        expect(m4?.status).toBe("invited");
        expect(m4?.invitedBy).toBe(u2.id);

        const reInviteData = await rpc<MutationAck>(c2, "invite_member", {
          p_group_id: groupId,
          p_user_id: u4.id,
        });
        expect(reInviteData.groupId).toBe(groupId);
        expect(reInviteData.eventId).toBeNull();

        const alreadyErr = await expectError(
          c1.rpc("invite_member", {
            p_group_id: groupId,
            p_user_id: u2.id,
          }),
        );
        expect(alreadyErr).toBe("already_member");
      });
    });

    describe("leave_group, remove_member, and delete_group", () => {
      it("enforces not_creator on remove_member", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Removal Group");
        const err = await expectError(
          c2.rpc("remove_member", {
            p_group_id: groupId,
            p_user_id: u1.id,
          }),
        );
        expect(err).toBe("not_creator");
      });

      it("blocks leave_group by outstanding_balance until the payment is recorded, then excludes group from bootstrap", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Leave Group");

        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id, u2.id], 1000, 0),
        });

        const balancesBefore = await getBalances(groupId);
        const leaverBalance = balancesBefore.find(
          (b) => b.participant_id === u2.id,
        );
        expect(leaverBalance?.net_cents).toBe(-500);

        const leaveErr = await expectError(
          c2.rpc("leave_group", { p_group_id: groupId }),
        );
        expect(leaveErr).toBe("outstanding_balance");

        const opId = crypto.randomUUID();
        const recordData = await rpc<SettlementAck>(c2, "record_settlement", {
          p_operation_id: opId,
          p_group_id: groupId,
          p_from_user_id: u2.id,
          p_to_user_id: u1.id,
          p_amount_cents: 500,
        });
        expect(recordData.settlementId).toBeDefined();

        const balancesAfter = await getBalances(groupId);
        expect(balancesAfter).toHaveLength(0);

        const leaveAck = await rpc<MutationAck>(c2, "leave_group", {
          p_group_id: groupId,
        });
        expect(leaveAck.groupId).toBe(groupId);

        const bootLeaver = await rpc<BootstrapPayload>(c2, "bootstrap");
        const foundGroup = bootLeaver.groups.find(
          (g) => g.group.id === groupId,
        );
        expect(foundGroup).toBeUndefined();
      });

      it("never lets the creator destroy a shared group's financial history", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Delete Group");

        await createExpense(u1, {
          groupId,
          totalCents: 600,
          payload: equalSplitPayload([u1.id, u2.id], 600, 0),
        });

        const deleteErr = await expectError(
          c1.rpc("delete_group", { p_group_id: groupId }),
        );
        expect(deleteErr).toBe("outstanding_balance");

        const settlement = await rpc<SettlementAck>(c2, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_from_user_id: u2.id,
          p_to_user_id: u1.id,
          p_amount_cents: 300,
        });
        expect(settlement.settlementId).toBeDefined();

        const settledErr = await expectError(
          c1.rpc("delete_group", { p_group_id: groupId }),
        );
        expect(settledErr).toBe("group_has_history");

        const bootMember = await rpc<BootstrapPayload>(c2, "bootstrap");
        expect(
          bootMember.groups.find((g) => g.group.id === groupId),
        ).toBeDefined();
      });

      it("deletes a solo group the creator never shared", async () => {
        const groupId = await createGroupWithMembers(u1, [], "Solo Group");

        await createExpense(u1, {
          groupId,
          totalCents: 600,
          payload: equalSplitPayload([u1.id], 600, 0),
        });

        const deleteAck = await rpc<{ groupId: string }>(c1, "delete_group", {
          p_group_id: groupId,
        });
        expect(deleteAck.groupId).toBe(groupId);

        const bootCreator = await rpc<BootstrapPayload>(c1, "bootstrap");
        expect(
          bootCreator.groups.find((g) => g.group.id === groupId),
        ).toBeUndefined();
      });

      it("requires current accepted membership for remove_member and delete_group after creator leaves", async () => {
        const [owner, peer] = await createTestUsers(2);
        const cOwner = authenticateAs(owner);

        const groupId = await createGroupWithMembers(owner, [peer], "Abandoned Group");

        const leaveAck = await rpc<{ groupId: string }>(cOwner, "leave_group", {
          p_group_id: groupId,
        });
        expect(leaveAck.groupId).toBe(groupId);

        const removeErr = await expectError(
          cOwner.rpc("remove_member", {
            p_group_id: groupId,
            p_user_id: peer.id,
          }),
        );
        expect(removeErr).toBe("not_a_member");

        const deleteErr = await expectError(
          cOwner.rpc("delete_group", {
            p_group_id: groupId,
          }),
        );
        expect(deleteErr).toBe("not_a_member");
      });
    });

    describe("shared financial history latch", () => {
      const latchOf = (groupId: string) =>
        withPg(async (pg) => {
          const { rows } = await pg.query<{ shared: boolean | null }>(
            "select (financial_history_shared_at is not null) as shared " +
              "from public.groups where id = $1",
            [groupId],
          );
          return rows[0]?.shared ?? null;
        });

      const clearLatch = (groupId: string) =>
        withPg(async (pg) => {
          await pg.query(
            "update public.groups set financial_history_shared_at = null where id = $1",
            [groupId],
          );
        });

      const zeroNetPayload = (a: string, b: string, cents: number) => {
        const half = cents / 2;
        return {
          items: [],
          participants: [
            { kind: "user", userId: a },
            { kind: "user", userId: b },
          ],
          shares: [half, half],
          payers: [
            { participantIndex: 0, amountCents: half },
            { participantIndex: 1, amountCents: half },
          ],
          itemAssignments: null,
        };
      };

      it("keeps the creator from destroying history a departed member once shared", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Latch Anchor");

        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: zeroNetPayload(u1.id, u2.id, 1000),
        });

        const leaveAck = await rpc<MutationAck>(c2, "leave_group", {
          p_group_id: groupId,
        });
        expect(leaveAck.groupId).toBe(groupId);

        const deleteErr = await expectError(
          c1.rpc("delete_group", { p_group_id: groupId }),
        );
        expect(deleteErr).toBe("group_has_history");

        await expect(await latchOf(groupId)).toBe(true);

        const facts = await withPg(async (pg) => {
          const { rows } = await pg.query<{ id: string }>(
            "select id from public.expenses where group_id = $1",
            [groupId],
          );
          return rows;
        });
        expect(facts).toHaveLength(1);
      });

      it("sets the latch when an expense lands in a group with two accepted members", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Latch Pair");
        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: zeroNetPayload(u1.id, u2.id, 1000),
        });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when a solo creation names an invited user", async () => {
        const groupId = (await createGroup(u1, "Latch Solo Named", [u2.id])).groupId;
        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: {
            items: [],
            participants: [
              { kind: "user", userId: u1.id },
              { kind: "user", userId: u2.id },
            ],
            shares: [500, 500],
            payers: [{ participantIndex: 0, amountCents: 1000 }],
            itemAssignments: null,
          },
        });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when an edit names a newly invited user", async () => {
        const groupId = (await createGroup(u1, "Latch Edit Named", [])).groupId;
        const expense = await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id], 1000),
        });
        expect(await latchOf(groupId)).toBe(false);

        await rpc<MutationAck>(c1, "invite_member", {
          p_group_id: groupId,
          p_user_id: u2.id,
        });
        await rpc<MutationAck>(c1, "edit_expense", {
          p_expense_id: expense.expenseId,
          p_expected_version_no: expense.versionNo,
          p_occurred_on: new Date().toISOString().slice(0, 10),
          p_title: "Latch Edit Named",
          p_merchant_name: null,
          p_expense_type: "single_amount",
          p_total_cents: 1000,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: {
            items: [],
            participants: [
              { kind: "user", userId: u1.id },
              { kind: "user", userId: u2.id },
            ],
            shares: [500, 500],
            payers: [{ participantIndex: 0, amountCents: 1000 }],
            itemAssignments: null,
          },
        });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when a restore reactivates facts shared with the group", async () => {
        const groupId = (await createGroup(u1, "Latch Restore", [])).groupId;
        const expense = await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id], 1000),
        });
        await rpc<MutationAck>(c1, "delete_expense", {
          p_expense_id: expense.expenseId,
        });
        await rpc<MutationAck>(c1, "invite_member", {
          p_group_id: groupId,
          p_user_id: u2.id,
        });
        await acceptInvitation(u2, groupId);
        await clearLatch(groupId);

        await rpc<MutationAck>(c1, "restore_expense", {
          p_expense_id: expense.expenseId,
        });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when an acceptance joins a group that already holds facts", async () => {
        const groupId = (await createGroup(u1, "Latch Accept Facts", [])).groupId;
        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id], 1000),
        });
        expect(await latchOf(groupId)).toBe(false);

        await rpc<MutationAck>(c1, "invite_member", {
          p_group_id: groupId,
          p_user_id: u2.id,
        });
        await acceptInvitation(u2, groupId);
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when a link join lands on a group that already holds facts", async () => {
        const groupId = (await createGroup(u1, "Latch Link Facts", [])).groupId;
        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id], 1000),
        });
        expect(await latchOf(groupId)).toBe(false);

        const link = await rpc<InviteLinkAck>(c1, "create_invite_link", {
          p_group_id: groupId,
        });
        await rpc<MutationAck>(c3, "join_via_link", { p_token: link.token });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when a guest claim grants membership for an existing expense", async () => {
        const groupId = (await createGroup(u1, "Latch Guest Claim", [])).groupId;
        const expense = await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: {
            items: [],
            participants: [
              { kind: "user", userId: u1.id },
              { kind: "guest", displayName: "Cobrador" },
            ],
            shares: [500, 500],
            payers: [{ participantIndex: 0, amountCents: 1000 }],
            itemAssignments: null,
          },
        });
        expect(await latchOf(groupId)).toBe(false);

        const view = await rpc<{
          participants: Array<{ kind: string; guest: { id: string } | null }>;
        }>(c1, "get_expense", { p_expense_id: expense.expenseId });
        const guest = view.participants.find((p) => p.kind === "guest");
        const token = await rpc<{ token: string }>(c1, "create_guest_claim_token", {
          p_guest_id: guest?.guest?.id ?? "",
        });
        await rpc<unknown>(c5, "claim_guest", { p_token: token.token });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("sets the latch when a settlement is recorded", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Latch Settlement");
        await createExpense(u1, {
          groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u1.id, u2.id], 1000),
        });
        await clearLatch(groupId);

        await rpc<SettlementAck>(c2, "record_settlement", {
          p_operation_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_from_user_id: u2.id,
          p_to_user_id: u1.id,
          p_amount_cents: 500,
        });
        expect(await latchOf(groupId)).toBe(true);
      });

      it("does not set the latch for an empty group holding only an invitation", async () => {
        const groupId = (await createGroup(u1, "Latch Empty Invite", [u2.id])).groupId;
        expect(await latchOf(groupId)).toBe(false);

        await acceptInvitation(u2, groupId);
        expect(await latchOf(groupId)).toBe(false);
      });

      it("does not set the latch for a zero-net solo expense and still deletes the group", async () => {
        const groupId = (await createGroup(u1, "Latch Solo Zero", [])).groupId;
        await createExpense(u1, {
          groupId,
          totalCents: 600,
          payload: equalSplitPayload([u1.id], 600),
        });
        expect(await latchOf(groupId)).toBe(false);

        const deleteAck = await rpc<{ groupId: string }>(c1, "delete_group", {
          p_group_id: groupId,
        });
        expect(deleteAck.groupId).toBe(groupId);
      });

      describe("deletion matrix", () => {
        it("keeps outstanding_balance ahead of group_has_history", async () => {
          const groupId = await createGroupWithMembers(u1, [u2], "Latch Matrix Debt");
          await createExpense(u1, {
            groupId,
            totalCents: 1000,
            payload: equalSplitPayload([u1.id, u2.id], 1000),
          });
          expect(await latchOf(groupId)).toBe(true);

          const err = await expectError(
            c1.rpc("delete_group", { p_group_id: groupId }),
          );
          expect(err).toBe("outstanding_balance");
        });

        it("denies with group_has_history when only the latch applies", async () => {
          const groupId = await createGroupWithMembers(u1, [u2], "Latch Matrix Latch");
          await createExpense(u1, {
            groupId,
            totalCents: 1000,
            payload: zeroNetPayload(u1.id, u2.id, 1000),
          });
          await rpc<MutationAck>(c2, "leave_group", { p_group_id: groupId });

          const err = await expectError(
            c1.rpc("delete_group", { p_group_id: groupId }),
          );
          expect(err).toBe("group_has_history");
        });

        it("still deletes a membered group with no facts and no latch", async () => {
          const groupId = await createGroupWithMembers(u1, [u2], "Latch Matrix Empty");
          expect(await latchOf(groupId)).toBe(false);

          const ack = await rpc<{ groupId: string }>(c1, "delete_group", {
            p_group_id: groupId,
          });
          expect(ack.groupId).toBe(groupId);
        });
      });

      describe("financial-history backfill", () => {
        const backfillSql = () => {
          const path = join(
            process.cwd(),
            "supabase/migrations/20260913010300_shared_financial_history.sql",
          );
          const sql = readFileSync(path, "utf8");
          const start = sql.indexOf("UPDATE public.groups g");
          const end = sql.indexOf(";", start);
          if (start < 0 || end < 0) {
            throw new Error(
              "backfill UPDATE not found in 20260913010300_shared_financial_history.sql",
            );
          }
          return sql.slice(start, end + 1);
        };

        const runBackfill = () =>
          withPg(async (pg) => {
            await pg.query(backfillSql());
          });

        it("latches a surviving noncreator membership beside facts", async () => {
          const groupId = (await createGroup(u1, "Backfill Surviving Member", [u2.id])).groupId;
          await createExpense(u1, {
            groupId,
            totalCents: 1000,
            payload: equalSplitPayload([u1.id], 1000),
          });
          await clearLatch(groupId);

          await runBackfill();
          expect(await latchOf(groupId)).toBe(true);
        });

        it("latches member join and leave events after the membership is gone", async () => {
          const groupId = await createGroupWithMembers(u1, [u2], "Backfill Departed");
          await createExpense(u1, {
            groupId,
            totalCents: 1000,
            payload: zeroNetPayload(u1.id, u2.id, 1000),
          });
          await rpc<MutationAck>(c2, "leave_group", { p_group_id: groupId });
          await clearLatch(groupId);

          await runBackfill();
          expect(await latchOf(groupId)).toBe(true);
        });

        it("latches a noncreator participant in the current facts", async () => {
          const groupId = crypto.randomUUID();
          const expenseId = crypto.randomUUID();
          await withPg(async (pg) => {
            await pg.query(
              "insert into public.groups (id, kind, name, creator_id) " +
                "values ($1, 'group', 'Backfill Participant', $2)",
              [groupId, u1.id],
            );
            await pg.query(
              "insert into public.expenses (id, client_id, group_id, creator_id, occurred_on) " +
                "values ($1, $2, $3, $4, current_date)",
              [expenseId, crypto.randomUUID(), groupId, u1.id],
            );
            await pg.query(
              "insert into public.expense_versions " +
                "(expense_id, version_no, author_id, title, expense_type, total_cents, payload) " +
                "values ($1, 1, $2, 'Backfill Participant', 'single_amount', 1000, $3)",
              [
                expenseId,
                u1.id,
                JSON.stringify({
                  items: [],
                  participants: [
                    { kind: "user", userId: u1.id },
                    { kind: "user", userId: u2.id },
                  ],
                  shares: [500, 500],
                  payers: [{ participantIndex: 0, amountCents: 1000 }],
                  itemAssignments: null,
                }),
              ],
            );
          });
          untrackTestGroup(groupId);

          await runBackfill();
          expect(await latchOf(groupId)).toBe(true);
        });

        it("does not latch an invitation that ended before any sharing", async () => {
          const groupId = (await createGroup(u1, "Backfill Declined", [u2.id])).groupId;
          await createExpense(u1, {
            groupId,
            totalCents: 1000,
            payload: equalSplitPayload([u1.id], 1000),
          });
          await rpc<MutationAck>(c2, "decline_invitation", { p_group_id: groupId });
          await clearLatch(groupId);

          await runBackfill();
          expect(await latchOf(groupId)).toBe(false);

          const ack = await rpc<{ groupId: string }>(c1, "delete_group", {
            p_group_id: groupId,
          });
          expect(ack.groupId).toBe(groupId);
        });

        it("does not latch solo facts with no sharing evidence", async () => {
          const groupId = (await createGroup(u1, "Backfill Solo", [])).groupId;
          await createExpense(u1, {
            groupId,
            totalCents: 600,
            payload: equalSplitPayload([u1.id], 600),
          });
          await clearLatch(groupId);

          await runBackfill();
          expect(await latchOf(groupId)).toBe(false);
        });
      });
    });

    describe("direct messages (DM)", () => {
      it("prevents self-DM with invalid_argument", async () => {
        const err = await expectError(
          c1.rpc("get_or_create_dm", { p_user_id: u1.id }),
        );
        expect(err).toBe("invalid_argument");
      });

      it("creates DM idempotently with canonical user ordering, kind dm, name empty, and blocks leave_group", async () => {
        const dm1 = await rpc<DmAck>(c1, "get_or_create_dm", {
          p_user_id: u2.id,
        });
        expect(dm1.created).toBe(true);
        expect(dm1.groupId).toBeDefined();

        const dm2 = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u1.id,
        });
        expect(dm2.groupId).toBe(dm1.groupId);
        expect(dm2.created).toBe(false);

        const snap = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: dm1.groupId,
        });
        expect(snap.group.kind).toBe("dm");
        expect(snap.group.name).toBe("");
        expect(snap.group.dmUserA).toBeDefined();
        expect(snap.group.dmUserB).toBeDefined();
        expect(snap.group.dmUserA! < snap.group.dmUserB!).toBe(true);

        const leaveErr = await expectError(
          c1.rpc("leave_group", { p_group_id: dm1.groupId }),
        );
        expect(leaveErr).toBe("cannot_leave_dm");
      });

      it("rejects third-user invitation into an accepted DM with invalid_operation", async () => {
        const [alice, bob, carol] = await createTestUsers(3);
        const cAlice = authenticateAs(alice);

        const dm = await rpc<DmAck>(cAlice, "get_or_create_dm", {
          p_user_id: bob.id,
        });
        await acceptInvitation(bob, dm.groupId);

        const inviteErr = await expectError(
          cAlice.rpc("invite_member", {
            p_group_id: dm.groupId,
            p_user_id: carol.id,
          }),
        );
        expect(inviteErr).toBe("invalid_operation");
      });

      it("rejects invite link operations and join_via_link on a DM with invalid_operation", async () => {
        const [alice, bob, carol] = await createTestUsers(3);
        const cAlice = authenticateAs(alice);
        const cCarol = authenticateAs(carol);

        const dm = await rpc<DmAck>(cAlice, "get_or_create_dm", {
          p_user_id: bob.id,
        });

        const linkErr = await expectError(
          cAlice.rpc("create_invite_link", {
            p_group_id: dm.groupId,
          }),
        );
        expect(linkErr).toBe("invalid_operation");

        const token = "test_dm_link_" + crypto.randomUUID().replace(/-/g, "");
        await withPg(async (pg) => {
          await pg.query(
            `INSERT INTO public.group_invite_links (group_id, token, created_by, is_active)
             VALUES ($1, $2, $3, true)`,
            [dm.groupId, token, alice.id],
          );
        });

        const joinErr = await expectError(
          cCarol.rpc("join_via_link", {
            p_token: token,
          }),
        );
        expect(joinErr).toBe("invalid_operation");
      });

      it("repairs noncanonical DM members by deleting them while preserving canonical members and history", async () => {
        const [alice, bob, carol] = await createTestUsers(3);
        const cAlice = authenticateAs(alice);

        const dm = await rpc<DmAck>(cAlice, "get_or_create_dm", {
          p_user_id: bob.id,
        });
        await acceptInvitation(bob, dm.groupId);

        await withPg(async (pg) => {
          await pg.query(
            `INSERT INTO public.group_members (group_id, user_id, status, accepted_at)
             VALUES ($1, $2, 'accepted', now())`,
            [dm.groupId, carol.id],
          );
        });

        const beforeSnap = await rpc<GroupSnapshot>(cAlice, "get_group", {
          p_group_id: dm.groupId,
        });
        expect(beforeSnap.members.map((m) => m.userId)).toContain(carol.id);

        await withPg(async (pg) => {
          await pg.query(
            `DELETE FROM public.group_members gm
             USING public.groups g
             WHERE gm.group_id = g.id
               AND g.kind = 'dm'
               AND gm.user_id IS DISTINCT FROM g.dm_user_a
               AND gm.user_id IS DISTINCT FROM g.dm_user_b`,
          );
        });

        const afterSnap = await rpc<GroupSnapshot>(cAlice, "get_group", {
          p_group_id: dm.groupId,
        });
        const memberIds = afterSnap.members.map((m) => m.userId);
        expect(memberIds).not.toContain(carol.id);
        expect(memberIds).toContain(alice.id);
        expect(memberIds).toContain(bob.id);
        expect(afterSnap.members.every((m) => m.status === "accepted")).toBe(true);
      });
    });

    describe("DM consent flow", () => {
      it("creates a pending DM: actor accepted, counterparty invited with invited_by and null accepted_at", async () => {
        const dm = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u3.id,
        });
        expect(dm.created).toBe(true);
        expect(dm.eventId).not.toBeNull();

        const snap = await rpc<GroupSnapshot>(c2, "get_group", {
          p_group_id: dm.groupId,
        });
        const initiator = snap.members.find((m) => m.userId === u2.id);
        const counterparty = snap.members.find((m) => m.userId === u3.id);
        expect(initiator?.status).toBe("accepted");
        expect(typeof initiator?.acceptedAt).toBe("string");
        expect(counterparty?.status).toBe("invited");
        expect(counterparty?.acceptedAt).toBeNull();
        expect(counterparty?.invitedBy).toBe(u2.id);
      });

      it("accepts an expense naming the invited counterparty", async () => {
        const [initiator, invitee] = await createTestUsers(2);
        const initiatorClient = authenticateAs(initiator);
        const dm = await rpc<DmAck>(initiatorClient, "get_or_create_dm", {
          p_user_id: invitee.id,
        });
        const ack = await rpc<{ expenseId: string }>(initiatorClient, "create_expense", {
          p_client_id: crypto.randomUUID(),
          p_group_id: dm.groupId,
          p_occurred_on: new Date().toISOString().slice(0, 10),
          p_title: "Almoço",
          p_merchant_name: null,
          p_expense_type: "single_amount",
          p_total_cents: 1000,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: equalSplitPayload([initiator.id, invitee.id], 1000, 0),
        });
        expect(ack.expenseId).toBeTruthy();

        const balances = await getBalances(dm.groupId);
        expect(balances.find((row) => row.participant_id === invitee.id)?.net_cents).toBe(-500);
      });

      it("blocks record_settlement toward the invited counterparty with counterparty_not_member", async () => {
        const dm = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u3.id,
        });
        const err = await expectError(
          c2.rpc("record_settlement", {
            p_operation_id: crypto.randomUUID(),
            p_group_id: dm.groupId,
            p_from_user_id: u2.id,
            p_to_user_id: u3.id,
            p_amount_cents: 100,
          }),
        );
        expect(err).toBe("counterparty_not_member");
      });

      it("lets the initiator chat but rejects messages from the invited counterparty", async () => {
        const dm = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u3.id,
        });

        const message = await rpc<{ id: string; content: string }>(
          c2,
          "send_message",
          {
            p_client_id: crypto.randomUUID(),
            p_group_id: dm.groupId,
            p_content: "Oi! Vamos dividir o almoço?",
          },
        );
        expect(message.content).toBe("Oi! Vamos dividir o almoço?");

        const invitedErr = await expectError(
          c3.rpc("send_message", {
            p_client_id: crypto.randomUUID(),
            p_group_id: dm.groupId,
            p_content: "Ainda não aceitei",
          }),
        );
        expect(invitedErr).toBe("not_a_member");
      });

      it("prunes the invited viewer's snapshot to self plus inviter with no money, expenses, or last message", async () => {
        const dm = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u3.id,
        });

        const snap = await rpc<GroupSnapshot>(c3, "get_group", {
          p_group_id: dm.groupId,
        });
        expect(snap.members).toHaveLength(2);
        expect(
          snap.members.find((m) => m.userId === u3.id)?.invitedBy,
        ).toBe(u2.id);
        expect(snap.balances).toEqual([]);
        expect(snap.settlements).toEqual([]);
        expect(snap.recentExpenses).toEqual([]);
        expect(snap.lastMessage).toBeNull();
      });

      it("keeps shared expense balances correct once the counterparty accepts", async () => {
        const dm = await rpc<DmAck>(c2, "get_or_create_dm", {
          p_user_id: u3.id,
        });

        const acceptAck = await rpc<MutationAck>(c3, "accept_invitation", {
          p_group_id: dm.groupId,
        });
        expect(acceptAck.groupId).toBe(dm.groupId);

        const expense = await createExpense(u2, {
          groupId: dm.groupId,
          totalCents: 1000,
          payload: equalSplitPayload([u2.id, u3.id], 1000, 0),
        });
        expect(expense.expenseId).toBeDefined();

        const balances = await getBalances(dm.groupId);
        const payerBalance = balances.find((b) => b.participant_id === u2.id);
        const counterpartyBalance = balances.find(
          (b) => b.participant_id === u3.id,
        );
        expect(payerBalance?.net_cents).toBe(500);
        expect(counterpartyBalance?.net_cents).toBe(-500);
      });

      it("removes the whole DM group when the invitation is declined, allowing a fresh DM", async () => {
        const dm = await rpc<DmAck>(c5, "get_or_create_dm", {
          p_user_id: u6.id,
        });
        expect(dm.created).toBe(true);

        const declineAck = await rpc<MutationAck>(c6, "decline_invitation", {
          p_group_id: dm.groupId,
        });
        expect(declineAck.groupId).toBe(dm.groupId);

        const goneErr = await expectError(
          c5.rpc("get_group", { p_group_id: dm.groupId }),
        );
        expect(goneErr).toBe("not_a_member");

        const fresh = await rpc<DmAck>(c5, "get_or_create_dm", {
          p_user_id: u6.id,
        });
        expect(fresh.created).toBe(true);
        expect(fresh.groupId).not.toBe(dm.groupId);
      });

      it("returns the same pending DM for repeated opens without flipping the counterparty to accepted", async () => {
        const dm1 = await rpc<DmAck>(c1, "get_or_create_dm", {
          p_user_id: u7.id,
        });
        expect(dm1.created).toBe(true);

        const dm2 = await rpc<DmAck>(c1, "get_or_create_dm", {
          p_user_id: u7.id,
        });
        expect(dm2.groupId).toBe(dm1.groupId);
        expect(dm2.created).toBe(false);
        expect(dm2.eventId).toBeNull();

        const dm3 = await rpc<DmAck>(c7, "get_or_create_dm", {
          p_user_id: u1.id,
        });
        expect(dm3.groupId).toBe(dm1.groupId);
        expect(dm3.created).toBe(false);
        expect(dm3.eventId).toBeNull();

        const snap = await rpc<GroupSnapshot>(c1, "get_group", {
          p_group_id: dm1.groupId,
        });
        const counterparty = snap.members.find((m) => m.userId === u7.id);
        expect(counterparty?.status).toBe("invited");
        expect(counterparty?.acceptedAt).toBeNull();
      });
    });

    describe("invite links lifecycle", () => {
      it("handles creation, anon preview, outsider join with event, max_uses exhaustion, deactivation by second create, and deactivate_invite_link", async () => {
        const groupId = await createGroupWithMembers(u1, [u2], "Link Group");

        const link1 = await rpc<InviteLinkAck>(c1, "create_invite_link", {
          p_group_id: groupId,
          p_expires_at: null,
          p_max_uses: 2,
        });
        const token1 = link1.token;
        expect(typeof token1).toBe("string");
        expect(token1.length).toBeGreaterThan(0);

        const preview1 = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: token1 },
        );
        expect(preview1.valid).toBe(true);
        expect(preview1.groupName).toBe("Link Group");
        expect(preview1.memberCount).toBe(2);

        const join5 = await rpc<MutationAck>(c5, "join_via_link", {
          p_token: token1,
        });
        expect(join5.groupId).toBe(groupId);
        expect(join5.eventId).not.toBeNull();

        const boot5 = await rpc<BootstrapPayload>(c5, "bootstrap");
        const g5 = boot5.groups.find((g) => g.group.id === groupId);
        expect(g5).toBeDefined();
        const m5 = g5?.members.find((m) => m.userId === u5.id);
        expect(m5?.status).toBe("accepted");

        const act5 = await rpc<ActivityEvent[]>(c5, "get_activity", {
          p_before_id: null,
          p_limit: 50,
        });
        const joinEvent = act5.find(
          (e) =>
            e.groupId === groupId &&
            e.kind === "member_joined" &&
            e.subjectUserId === u5.id,
        );
        expect(joinEvent).toBeDefined();

        await rpc<MutationAck>(c6, "join_via_link", { p_token: token1 });

        const exhaustedPreview = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: token1 },
        );
        expect(exhaustedPreview.valid).toBe(false);

        const exhaustErr = await expectError(
          c7.rpc("join_via_link", { p_token: token1 }),
        );
        expect(exhaustErr).toBe("invalid_link");

        const group2Id = await createGroupWithMembers(
          u1,
          [u2],
          "Deactivation Group",
        );
        const linkA = await rpc<InviteLinkAck>(c1, "create_invite_link", {
          p_group_id: group2Id,
          p_expires_at: null,
          p_max_uses: null,
        });
        const tokenA = linkA.token;

        const previewAActive = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: tokenA },
        );
        expect(previewAActive.valid).toBe(true);

        const linkB = await rpc<InviteLinkAck>(c1, "create_invite_link", {
          p_group_id: group2Id,
          p_expires_at: null,
          p_max_uses: null,
        });
        const tokenB = linkB.token;

        const previewADeactivated = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: tokenA },
        );
        expect(previewADeactivated.valid).toBe(false);

        const joinDeactivatedErr = await expectError(
          c7.rpc("join_via_link", { p_token: tokenA }),
        );
        expect(joinDeactivatedErr).toBe("invalid_link");

        const previewBActive = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: tokenB },
        );
        expect(previewBActive.valid).toBe(true);

        const deactAck = await rpc<{ groupId: string }>(
          c1,
          "deactivate_invite_link",
          { p_group_id: group2Id },
        );
        expect(deactAck.groupId).toBe(group2Id);

        const previewBDeactivated = await rpc<InviteLinkPreview>(
          anonClient,
          "preview_invite_link",
          { p_token: tokenB },
        );
        expect(previewBDeactivated.valid).toBe(false);
      });
    });

    describe("user profile update and handle lookup", () => {
      it("enforces handle uniqueness, length validation, and updates profile correctly", async () => {
        const takenErr = await expectError(
          c3.rpc("update_profile", {
            p_name: null,
            p_handle: u1.handle,
            p_notification_preferences: null,
          }),
        );
        expect(takenErr).toBe("handle_taken");

        const invalidErr = await expectError(
          c3.rpc("update_profile", {
            p_name: null,
            p_handle: "ab",
            p_notification_preferences: null,
          }),
        );
        expect(invalidErr).toBe("invalid_handle");

        const newHandle = `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
        const newName = "Novo Nome Legal";

        const updatedMe = await rpc<MeProfile>(c3, "update_profile", {
          p_name: newName,
          p_handle: newHandle,
          p_notification_preferences: null,
        });
        expect(updatedMe.name).toBe(newName);
        expect(updatedMe.handle).toBe(newHandle);
        expect(updatedMe.onboarded).toBe(true);

        const myProfile = await rpc<MeProfile>(c3, "get_my_profile");
        expect(myProfile.name).toBe(newName);
        expect(myProfile.handle).toBe(newHandle);
        expect(myProfile.onboarded).toBe(true);

        const invalidPrefKeyErr = await expectError(
          c3.rpc("update_profile", {
            p_name: null,
            p_handle: null,
            p_notification_preferences: { promotions: false },
          }),
        );
        expect(invalidPrefKeyErr).toBe("invalid_notification_preferences");

        const invalidPrefValueErr = await expectError(
          c3.rpc("update_profile", {
            p_name: null,
            p_handle: null,
            p_notification_preferences: { nudges: "yes" },
          }),
        );
        expect(invalidPrefValueErr).toBe("invalid_notification_preferences");

        const nonObjectErr = await expectError(
          c3.rpc("update_profile", {
            p_name: null,
            p_handle: null,
            p_notification_preferences: [false],
          }),
        );
        expect(nonObjectErr).toBe("invalid_notification_preferences");

        await rpc<MeProfile>(c3, "update_profile", {
          p_name: null,
          p_handle: null,
          p_notification_preferences: { messages: false },
        });
        const afterNudges = await rpc<MeProfile>(c3, "update_profile", {
          p_name: null,
          p_handle: null,
          p_notification_preferences: { nudges: false },
        });
        expect(afterNudges.notificationPreferences).toMatchObject({
          messages: false,
          nudges: false,
        });

        const afterReEnable = await rpc<MeProfile>(c3, "update_profile", {
          p_name: null,
          p_handle: null,
          p_notification_preferences: { messages: true },
        });
        expect(afterReEnable.notificationPreferences).toMatchObject({
          messages: true,
          nudges: false,
        });
      });
      // Since 20260913010070 the lookup boundary is route-only: direct RPC
      // execution is denied for every browser role. The profile semantics
      // that used to be asserted here (found user, missing handle, the
      // un-onboarded privacy filter) live at the route level now
      // (src/app/api/users/lookup/route.integration.test.ts).
      it("denies direct authenticated RPC lookups after the service-role cutover", async () => {
        const err = await expectRpcError(
          c1.rpc("lookup_user_by_handle", { p_handle: "any_handle_at_all" }),
        );
        expect(err).toMatch(/permission denied/i);
      });

      it("denies anonymous REST lookups", async () => {
        const err = await expectRpcError(
          anonClient.rpc("lookup_user_by_handle", { p_handle: "any_handle_at_all" }),
        );
        expect(err).toMatch(/permission denied/i);
      });
    });

    describe("group_member_exclusions and member_excluded enforcement", () => {
      it("remove_member writes/updates exclusion row, invite by other member fails, creator re-invite clears it", async () => {
        const [creator, member, other] = await createTestUsers(3);
        const cCreator = authenticateAs(creator);
        const cMember = authenticateAs(member);
        const cOther = authenticateAs(other);

        const groupId = await createGroupWithMembers(creator, [member, other], "Exclusion Test Group");

        // Creator removes member
        const removeAck = await rpc<MutationAck>(cCreator, "remove_member", {
          p_group_id: groupId,
          p_user_id: member.id,
        });
        expect(removeAck.groupId).toBe(groupId);

        // Assert exclusion row in DB
        const exclusion = await withPg(async (pg) => {
          const res = await pg.query<{ excluded_by: string; excluded_at: string }>(
            "SELECT excluded_by, excluded_at FROM public.group_member_exclusions WHERE group_id = $1 AND user_id = $2",
            [groupId, member.id],
          );
          return res.rows[0];
        });
        expect(exclusion).toBeDefined();
        expect(exclusion?.excluded_by).toBe(creator.id);

        // Other accepted member tries to invite the excluded member -> member_excluded
        const otherInviteErr = await expectRpcError(
          cOther.rpc("invite_member", {
            p_group_id: groupId,
            p_user_id: member.id,
          }),
        );
        expect(otherInviteErr).toBe("member_excluded");

        // Excluded user tries to accept invitation -> member_excluded
        const acceptErr = await expectRpcError(
          cMember.rpc("accept_invitation", {
            p_group_id: groupId,
          }),
        );
        expect(acceptErr).toBe("member_excluded");

        // Excluded user tries to join via active invite link -> member_excluded
        const link = await rpc<InviteLinkAck>(cCreator, "create_invite_link", {
          p_group_id: groupId,
        });
        const joinErr = await expectRpcError(
          cMember.rpc("join_via_link", {
            p_token: link.token,
          }),
        );
        expect(joinErr).toBe("member_excluded");

        // Creator re-invites excluded user -> succeeds and atomically clears exclusion
        const creatorInviteAck = await rpc<MutationAck>(cCreator, "invite_member", {
          p_group_id: groupId,
          p_user_id: member.id,
        });
        expect(creatorInviteAck.groupId).toBe(groupId);

        const exclusionAfter = await withPg(async (pg) => {
          const res = await pg.query(
            "SELECT 1 FROM public.group_member_exclusions WHERE group_id = $1 AND user_id = $2",
            [groupId, member.id],
          );
          return res.rowCount;
        });
        expect(exclusionAfter).toBe(0);

        // Member can now accept
        const acceptAck = await rpc<MutationAck>(cMember, "accept_invitation", {
          p_group_id: groupId,
        });
        expect(acceptAck.groupId).toBe(groupId);
      });

      it("leave_group and decline_invitation never write exclusion", async () => {
        const [creator, member, invitee] = await createTestUsers(3);
        const cCreator = authenticateAs(creator);
        const cMember = authenticateAs(member);
        const cInvitee = authenticateAs(invitee);

        const groupId = await createGroupWithMembers(creator, [member], "Leave Group Exclusion");

        // Member leaves voluntarily
        await rpc(cMember, "leave_group", { p_group_id: groupId });
        const leaverExclusion = await withPg(async (pg) => {
          const res = await pg.query(
            "SELECT 1 FROM public.group_member_exclusions WHERE group_id = $1 AND user_id = $2",
            [groupId, member.id],
          );
          return res.rowCount;
        });
        expect(leaverExclusion).toBe(0);

        // Invitee declines
        await rpc(cCreator, "invite_member", { p_group_id: groupId, p_user_id: invitee.id });
        await rpc(cInvitee, "decline_invitation", { p_group_id: groupId });
        const declinerExclusion = await withPg(async (pg) => {
          const res = await pg.query(
            "SELECT 1 FROM public.group_member_exclusions WHERE group_id = $1 AND user_id = $2",
            [groupId, invitee.id],
          );
          return res.rowCount;
        });
        expect(declinerExclusion).toBe(0);
      });

      it("get_or_create_dm rejects if exclusion exists on the DM group", async () => {
        const [alice, bob] = await createTestUsers(2);
        const cAlice = authenticateAs(alice);

        const dm = await rpc<DmAck>(cAlice, "get_or_create_dm", {
          p_user_id: bob.id,
        });
        expect(dm.groupId).toBeDefined();

        // Seed an exclusion on this DM
        await withPg(async (pg) => {
          await pg.query(
            "INSERT INTO public.group_member_exclusions (group_id, user_id, excluded_by) VALUES ($1, $2, $3)",
            [dm.groupId, bob.id, alice.id],
          );
        });

        // Reusing or calling get_or_create_dm now fails with member_excluded
        const dmErr = await expectRpcError(
          cAlice.rpc("get_or_create_dm", { p_user_id: bob.id }),
        );
        expect(dmErr).toBe("member_excluded");
      });
    });

    describe("expenses with a pending invitee", () => {
      it("splits with an invited member but refuses to settle with them", async () => {
        const [creator, invitee] = await createTestUsers(2);
        const { groupId } = await createGroup(creator, "Pendente", [invitee.id]);

        const { expenseId } = await createExpense(creator, {
          groupId,
          totalCents: 5000,
          payload: equalSplitPayload([creator.id, invitee.id], 5000),
        });
        expect(expenseId).toBeTruthy();

        const balances = await getBalances(groupId);
        const inviteeBalance = balances.find((row) => row.participant_id === invitee.id);
        expect(inviteeBalance?.net_cents).toBe(-2500);

        const message = await expectError(
          authenticateAs(creator).rpc("record_settlement", {
            p_operation_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_from_user_id: invitee.id,
            p_to_user_id: creator.id,
            p_amount_cents: 2500,
          }),
        );
        expect(message).toContain("counterparty_not_member");
      });

      it("invalidates only the expenses naming the decliner", async () => {
        const [creator, invitee, other] = await createTestUsers(3);
        const { groupId } = await createGroup(creator, "Recusa", [invitee.id, other.id]);
        await acceptInvitation(other, groupId);

        const withInvitee = await createExpense(creator, {
          groupId,
          totalCents: 4000,
          payload: equalSplitPayload([creator.id, invitee.id], 4000),
        });
        const withoutInvitee = await createExpense(creator, {
          groupId,
          totalCents: 6000,
          payload: equalSplitPayload([creator.id, other.id], 6000),
        });

        await rpc(authenticateAs(invitee), "decline_invitation", { p_group_id: groupId });

        const statuses = await withPg(async (pg) => {
          const result = await pg.query<{ id: string; status: string }>(
            "select id, status from public.expenses where group_id = $1",
            [groupId],
          );
          return new Map(result.rows.map((row) => [row.id, row.status]));
        });
        expect(statuses.get(withInvitee.expenseId)).toBe("deleted");
        expect(statuses.get(withoutInvitee.expenseId)).toBe("active");

        const balances = await getBalances(groupId);
        expect(balances.some((row) => row.participant_id === invitee.id)).toBe(false);
        expect(balances.find((row) => row.participant_id === other.id)?.net_cents).toBe(-3000);

        const invalidated = await rpc<{ participants: unknown[] }>(
          authenticateAs(creator),
          "get_expense",
          { p_expense_id: withInvitee.expenseId },
        );
        expect(invalidated.participants).toEqual([]);

        const snapshot = await rpc<{ recentExpenses: Array<{ id: string; myShareCents: number }> }>(
          authenticateAs(creator),
          "get_group",
          { p_group_id: groupId },
        );
        const summary = snapshot.recentExpenses.find((row) => row.id === withInvitee.expenseId);
        expect(summary?.myShareCents).toBe(0);
      });
    });
  },
);
