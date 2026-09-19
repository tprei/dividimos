import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";

interface RpcError {
  message: string;
}

async function rpc<T>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(functionName as never, args as never)) as {
    data: T | null;
    error: RpcError | null;
  };
  if (error) throw new Error(`${functionName} failed: ${error.message}`);
  return data as T;
}

interface GroupOverview {
  avatar: { kind: string };
  spending: {
    totalCents: number;
    participants: Array<{
      kind: "user" | "guest";
      participantId: string;
      shareCents: number;
      user?: { id: string; name: string };
      displayName?: string;
    }>;
  } | null;
}

interface GroupOverviewResponse {
  snapshot: { group: { id: string; kind: string } };
  overview: GroupOverview;
}

describe.skipIf(!isIntegrationTestReady)("group overview reads", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let aliceClient: SupabaseClient;
  let carolClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  beforeAll(async () => {
    [alice, bob, carol, outsider] = await createTestUsers(4);
    aliceClient = authenticateAs(alice);
    carolClient = authenticateAs(carol);
    outsiderClient = authenticateAs(outsider);
  });

  it("returns current totals and accepted members with zero shares", async () => {
    const groupId = await createGroupWithMembers(alice, [bob, carol], "Overview totals");
    await createExpense(alice, {
      groupId,
      totalCents: 6000,
      payload: equalSplitPayload([alice.id, bob.id], 6000),
    });

    const result = await rpc<GroupOverviewResponse>(aliceClient, "get_group_overview", {
      p_group_id: groupId,
    });

    expect(result.overview.spending).toMatchObject({ totalCents: 6000 });
    expect(result.overview.spending?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user", participantId: alice.id, shareCents: 3000 }),
        expect.objectContaining({ kind: "user", participantId: bob.id, shareCents: 3000 }),
        expect.objectContaining({ kind: "user", participantId: carol.id, shareCents: 0 }),
      ]),
    );
  });

  it("uses the current expense version and reattributes claimed guests", async () => {
    const groupId = await createGroupWithMembers(alice, [bob], "Overview claims");
    const created = await createExpense(alice, {
      groupId,
      totalCents: 9000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "guest", guestId: null, displayName: "Convidado" },
        ],
        shares: [3000, 3000, 3000],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });
    const expense = await rpc<{
      current: { payload: { participants: Array<{ kind: string; guestId?: string | null }> } };
    }>(aliceClient, "get_expense", { p_expense_id: created.expenseId });
    const guest = expense.current.payload.participants.find((participant) => participant.kind === "guest");
    if (!guest?.guestId) throw new Error("fixture did not materialize a guest");

    const token = await rpc<{ token: string }>(aliceClient, "create_guest_claim_token", {
      p_guest_id: guest.guestId,
    });
    await rpc(carolClient, "claim_guest", { p_token: token.token });

    const result = await rpc<GroupOverviewResponse>(aliceClient, "get_group_overview", {
      p_group_id: groupId,
    });
    expect(result.overview.spending?.totalCents).toBe(9000);
    expect(result.overview.spending?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user", participantId: carol.id, shareCents: 3000 }),
      ]),
    );
    expect(result.overview.spending?.participants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "guest", participantId: guest.guestId })]),
    );
  });

  it("redacts spending for invited members and rejects outsiders", async () => {
    const groupId = await createGroupWithMembers(alice, [bob], "Overview access");
    const inviteResponse = await aliceClient.rpc("invite_member" as never, {
      p_group_id: groupId,
      p_user_id: carol.id,
    } as never);
    expect(inviteResponse.error).toBeNull();

    const invited = await rpc<GroupOverviewResponse>(carolClient, "get_group_overview", {
      p_group_id: groupId,
    });
    expect(invited.overview.spending).toBeNull();
    expect(invited.overview.avatar).toEqual({ kind: "initials" });

    await expectRpcError(
      Promise.resolve(outsiderClient.rpc("get_group_overview" as never, { p_group_id: groupId } as never)),
    ).then((code) => expect(code).toBe("not_a_member"));
  });

  it("keeps legacy group reads on their exact old wire shape", async () => {
    const groupId = await createGroupWithMembers(alice, [bob], "Overview compatibility");
    const legacy = await rpc<Record<string, unknown>>(aliceClient, "get_group", {
      p_group_id: groupId,
    });

    expect(Object.keys(legacy).sort()).toEqual(["expenses", "group", "members", "settlements"].sort());
    expect((legacy.group as Record<string, unknown>).id).toBe(groupId);
  });

  it("includes the same overview wrapper in bootstrap reads", async () => {
    const groupId = await createGroupWithMembers(alice, [bob], "Overview bootstrap");
    const bootstrap = await rpc<{ groups: Array<{ snapshot: { group: { id: string } }; overview: GroupOverview }> }>(
      aliceClient,
      "bootstrap_overview",
      {},
    );
    const group = bootstrap.groups.find((entry) => entry.snapshot.group.id === groupId);
    expect(group?.overview.spending?.totalCents).toBe(0);
    expect(group?.overview.spending?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user", participantId: alice.id, shareCents: 0 }),
        expect.objectContaining({ kind: "user", participantId: bob.id, shareCents: 0 }),
      ]),
    );
  });
});
