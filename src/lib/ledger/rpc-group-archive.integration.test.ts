import { describe, it, expect, beforeAll } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  createGroup,
  createGroupWithMembers,
  acceptInvitation,
  createExpense,
  equalSplitPayload,
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
  isBot: boolean;
}

interface GroupSnapshot {
  group: { id: string; kind: "group" | "dm"; creatorId: string; ledgerVersion: number };
  balances: Array<{ kind: string; participantId: string; netCents: number }>;
}

interface OverviewV2Entry {
  snapshot: GroupSnapshot;
  overview: unknown;
  archivedAt: string | null;
  financialHistorySharedAt: string | null;
  formerMembers: UserProfile[];
}

interface BootstrapV2Payload {
  groups: OverviewV2Entry[];
}

interface ArchiveAck {
  groupId: string;
  archivedAt: string | null;
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
  eventId: number | null;
}

interface DmAck {
  groupId: string;
  created: boolean;
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

function v2Entry(
  payload: BootstrapV2Payload,
  groupId: string,
): OverviewV2Entry {
  const entry = payload.groups.find((g) => g.snapshot.group.id === groupId);
  if (!entry) throw new Error(`group ${groupId} missing from bootstrap_overview_v2`);
  return entry;
}

async function readV2(
  client: SupabaseClient,
  groupId: string,
): Promise<OverviewV2Entry> {
  return rpc<OverviewV2Entry>(client, "get_group_overview_v2", { p_group_id: groupId });
}

describe.skipIf(!isIntegrationTestReady)(
  "group archive RPCs integration tests",
  () => {
    let u1: TestUser;
    let u2: TestUser;
    let u3: TestUser;
    let u4: TestUser;

    let c1: SupabaseClient;
    let c2: SupabaseClient;
    let c3: SupabaseClient;
    let c4: SupabaseClient;

    beforeAll(async () => {
      const users = await createTestUsers(4);
      [u1, u2, u3, u4] = users;

      c1 = authenticateAs(u1);
      c2 = authenticateAs(u2);
      c3 = authenticateAs(u3);
      c4 = authenticateAs(u4);
    });

    it("archives a zero-balance member per viewer while bootstrap_overview_v2 keeps the group", async () => {
      const groupId = await createGroupWithMembers(u1, [u2]);

      const ack = await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: groupId });
      expect(ack.groupId).toBe(groupId);
      expect(typeof ack.archivedAt).toBe("string");

      const ownEntry = await readV2(c2, groupId);
      expect(ownEntry.archivedAt).toBe(ack.archivedAt);
      expect(ownEntry.financialHistorySharedAt).toBeNull();
      expect(ownEntry.formerMembers).toEqual([]);

      const otherEntry = await readV2(c1, groupId);
      expect(otherEntry.archivedAt).toBeNull();

      const boot = await rpc<BootstrapV2Payload>(c2, "bootstrap_overview_v2", {});
      expect(v2Entry(boot, groupId).archivedAt).toBe(ack.archivedAt);
    });

    it("keeps the original archivedAt on repeated archive and clears it on unarchive", async () => {
      const groupId = await createGroupWithMembers(u1, [u2]);

      const first = await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: groupId });
      const second = await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: groupId });
      expect(second.archivedAt).toBe(first.archivedAt);

      const unarchived = await rpc<ArchiveAck>(c2, "unarchive_group", { p_group_id: groupId });
      expect(unarchived.groupId).toBe(groupId);
      expect(unarchived.archivedAt).toBeNull();

      const entry = await readV2(c2, groupId);
      expect(entry.archivedAt).toBeNull();

      const reArchived = await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: groupId });
      expect(typeof reArchived.archivedAt).toBe("string");
    });

    it("archives DMs like groups", async () => {
      const dm = await rpc<DmAck>(c1, "get_or_create_dm", { p_user_id: u2.id });

      const ack = await rpc<ArchiveAck>(c1, "archive_group", { p_group_id: dm.groupId });
      expect(typeof ack.archivedAt).toBe("string");

      const entry = await readV2(c1, dm.groupId);
      expect(entry.archivedAt).toBe(ack.archivedAt);
      expect(entry.snapshot.group.kind).toBe("dm");

      const unarchived = await rpc<ArchiveAck>(c1, "unarchive_group", { p_group_id: dm.groupId });
      expect(unarchived.archivedAt).toBeNull();
    });

    it("denies archive and unarchive to outsiders, pending invitees, and members with balances, and rejects null group ids", async () => {
      const { groupId } = await createGroup(u1, "Grupo denegado", [u2.id, u3.id]);
      await acceptInvitation(u2, groupId);

      const outsiderErr = await expectError(c4.rpc("archive_group", { p_group_id: groupId }));
      expect(outsiderErr).toBe("not_a_member");

      const unarchiveOutsiderErr = await expectError(
        c4.rpc("unarchive_group", { p_group_id: groupId }),
      );
      expect(unarchiveOutsiderErr).toBe("not_a_member");

      const v2OutsiderErr = await expectError(
        c4.rpc("get_group_overview_v2", { p_group_id: groupId }),
      );
      expect(v2OutsiderErr).toBe("not_a_member");

      const inviteeErr = await expectError(c3.rpc("archive_group", { p_group_id: groupId }));
      expect(inviteeErr).toBe("not_a_member");

      const unarchiveInviteeErr = await expectError(
        c3.rpc("unarchive_group", { p_group_id: groupId }),
      );
      expect(unarchiveInviteeErr).toBe("not_a_member");

      await createExpense(u1, {
        groupId,
        totalCents: 1000,
        payload: equalSplitPayload([u1.id, u2.id], 1000),
      });

      const debtorErr = await expectError(c2.rpc("archive_group", { p_group_id: groupId }));
      expect(debtorErr).toBe("outstanding_balance");

      const creditorErr = await expectError(c1.rpc("archive_group", { p_group_id: groupId }));
      expect(creditorErr).toBe("outstanding_balance");

      const nullArchiveErr = await expectError(
        c1.rpc("archive_group" as never, { p_group_id: null } as never),
      );
      expect(nullArchiveErr).toBe("invalid_argument");

      const nullUnarchiveErr = await expectError(
        c1.rpc("unarchive_group" as never, { p_group_id: null } as never),
      );
      expect(nullUnarchiveErr).toBe("invalid_argument");
    });

    it("auto-unarchives a member whose net becomes nonzero and keeps archived one at zero net", async () => {
      const chargedGroupId = await createGroupWithMembers(u1, [u2, u3]);
      await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: chargedGroupId });

      await createExpense(u1, {
        groupId: chargedGroupId,
        totalCents: 1000,
        payload: equalSplitPayload([u1.id, u2.id], 1000),
      });

      const chargedEntry = await readV2(c2, chargedGroupId);
      expect(chargedEntry.archivedAt).toBeNull();

      const untouchedGroupId = await createGroupWithMembers(u1, [u2, u3]);
      await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: untouchedGroupId });

      await createExpense(u1, {
        groupId: untouchedGroupId,
        totalCents: 1000,
        payload: equalSplitPayload([u1.id, u3.id], 1000),
      });

      const untouchedEntry = await readV2(c2, untouchedGroupId);
      expect(untouchedEntry.archivedAt).not.toBeNull();
    });

    it("keeps a group archived when a message arrives after the archive", async () => {
      const groupId = await createGroupWithMembers(u1, [u2]);
      await rpc<ArchiveAck>(c2, "archive_group", { p_group_id: groupId });

      await rpc<MutationAck>(c1, "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_content: "E aí",
      });

      const entry = await readV2(c2, groupId);
      expect(entry.archivedAt).not.toBeNull();
    });

    it("serves an invited viewer a null lifecycle entry", async () => {
      const { groupId } = await createGroup(u1, "Grupo convite", [u2.id]);
      await createExpense(u1, {
        groupId,
        totalCents: 1000,
        payload: equalSplitPayload([u1.id], 1000),
      });

      const entry = await readV2(c2, groupId);
      expect(entry.archivedAt).toBeNull();
      expect(entry.financialHistorySharedAt).toBeNull();
      expect(entry.formerMembers).toEqual([]);
    });

    it("reproduces the production sequence: former-member balances surface, block delete and archive, and clear when the settlement is voided", async () => {
      const groupId = await createGroupWithMembers(u1, [u2]);

      const expense = await createExpense(u1, {
        groupId,
        totalCents: 1000,
        payload: equalSplitPayload([u1.id, u2.id], 1000),
      });

      const settlement = await rpc<SettlementAck>(c2, "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_from_user_id: u2.id,
        p_to_user_id: u1.id,
        p_amount_cents: 500,
      });
      const settledEntry = await readV2(c1, groupId);
      expect(settledEntry.snapshot.balances).toEqual([]);

      await rpc<MutationAck>(c1, "remove_member", { p_group_id: groupId, p_user_id: u2.id });
      await rpc<MutationAck>(c1, "delete_expense", { p_expense_id: expense.expenseId });

      const entry = await readV2(c1, groupId);
      const expectedBalances = [
        { kind: "user", participantId: u1.id, netCents: -500 },
        { kind: "user", participantId: u2.id, netCents: 500 },
      ];
      expectedBalances.sort((a, b) => (a.participantId < b.participantId ? -1 : 1));
      expect(entry.snapshot.balances).toEqual(expectedBalances);
      expect(entry.formerMembers).toHaveLength(1);
      expect(entry.formerMembers[0].id).toBe(u2.id);
      expect(entry.formerMembers[0].handle).toBe(u2.handle);
      expect(entry.formerMembers[0].name).toBe(u2.name);
      expect(entry.financialHistorySharedAt).not.toBeNull();

      expect(await expectError(c1.rpc("delete_group", { p_group_id: groupId }))).toBe(
        "outstanding_balance",
      );
      expect(await expectError(c1.rpc("archive_group", { p_group_id: groupId }))).toBe(
        "outstanding_balance",
      );

      await rpc<MutationAck>(c1, "void_settlement", { p_settlement_id: settlement.settlementId });

      const entryAfterVoid = await readV2(c1, groupId);
      expect(entryAfterVoid.snapshot.balances).toEqual([]);
      expect(entryAfterVoid.formerMembers).toEqual([]);

      const archiveAck = await rpc<ArchiveAck>(c1, "archive_group", { p_group_id: groupId });
      expect(typeof archiveAck.archivedAt).toBe("string");

      expect(await expectError(c1.rpc("delete_group", { p_group_id: groupId }))).toBe(
        "group_has_history",
      );

      const finalEntry = await readV2(c1, groupId);
      expect(finalEntry.financialHistorySharedAt).not.toBeNull();
      expect(finalEntry.archivedAt).toBe(archiveAck.archivedAt);
    });

    it("leaves a fresh money-free group deletable with a null financialHistorySharedAt", async () => {
      const groupId = await createGroupWithMembers(u1, [u2]);

      const entry = await readV2(c1, groupId);
      expect(entry.financialHistorySharedAt).toBeNull();

      const ack = await rpc<{ groupId: string }>(c1, "delete_group", { p_group_id: groupId });
      expect(ack.groupId).toBe(groupId);
    });
  },
);
