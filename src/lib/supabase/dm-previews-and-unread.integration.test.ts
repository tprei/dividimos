import { describe, it, expect } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import {
  createTestUser,
  authenticateAs,
} from "@/test/integration-helpers";

async function createDmGroup(alice: { id: string; accessToken?: string }, bobId: string): Promise<string> {
  const aliceClient = authenticateAs(alice as Parameters<typeof authenticateAs>[0]);
  const { data: groupId, error } = await aliceClient.rpc("get_or_create_dm_group", {
    p_other_user_id: bobId,
  });
  if (error || !groupId) throw new Error(`get_or_create_dm_group failed: ${error?.message}`);
  return groupId as string;
}

async function insertMessage(
  groupId: string,
  senderId: string,
  content: string,
  createdAt?: string,
): Promise<string> {
  const { data, error } = await adminClient!
    .from("chat_messages")
    .insert({
      group_id: groupId,
      sender_id: senderId,
      content,
      message_type: "text" as const,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`Failed to insert message: ${error?.message}`);
  return (data as { id: string; created_at: string }).created_at;
}

async function upsertReadReceipt(userId: string, groupId: string, lastReadAt: string): Promise<void> {
  const { error } = await adminClient!
    .from("conversation_read_receipts")
    .upsert(
      { user_id: userId, group_id: groupId, last_read_at: lastReadAt },
      { onConflict: "user_id,group_id" },
    );
  if (error) throw new Error(`Failed to upsert read receipt: ${error.message}`);
}

describe.skipIf(!isIntegrationTestReady)(
  "get_dm_previews and get_unread_counts RPCs",
  () => {
    describe("get_dm_previews", () => {
      it("returns exactly one row with the latest message for a single DM group", async () => {
        const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
        const groupId = await createDmGroup(alice, bob.id);

        await insertMessage(groupId, alice.id, "first message", "2026-05-16T10:00:00Z");
        await insertMessage(groupId, bob.id, "second message", "2026-05-16T11:00:00Z");
        const latestAt = await insertMessage(groupId, alice.id, "latest message", "2026-05-16T12:00:00Z");

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_dm_previews", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect((data as { group_id: string; content: string; created_at: string }[])[0].group_id).toBe(groupId);
        expect((data as { group_id: string; content: string; created_at: string }[])[0].content).toBe("latest message");
        expect(new Date((data as { group_id: string; content: string; created_at: string }[])[0].created_at).getTime()).toBe(new Date(latestAt).getTime());
      });

      it("returns one row per group when called with multiple DM group ids", async () => {
        const [alice, bob, carol] = await Promise.all([
          createTestUser(),
          createTestUser(),
          createTestUser(),
        ]);

        const [groupAB, groupAC] = await Promise.all([
          createDmGroup(alice, bob.id),
          createDmGroup(alice, carol.id),
        ]);

        await Promise.all([
          insertMessage(groupAB, bob.id, "hi from bob"),
          insertMessage(groupAC, carol.id, "hi from carol"),
        ]);

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_dm_previews", {
          p_group_ids: [groupAB, groupAC],
        });

        expect(error).toBeNull();

        const rows = data as { group_id: string; content: string }[];
        expect(rows).toHaveLength(2);

        const byGroup = new Map(rows.map((r) => [r.group_id, r]));
        expect(byGroup.get(groupAB)?.content).toBe("hi from bob");
        expect(byGroup.get(groupAC)?.content).toBe("hi from carol");
      });

      it("returns empty array for a group with no messages", async () => {
        const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
        const groupId = await createDmGroup(alice, bob.id);

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_dm_previews", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it("RLS: outsider gets empty result for a DM group they are not in", async () => {
        const [alice, bob, carol] = await Promise.all([
          createTestUser(),
          createTestUser(),
          createTestUser(),
        ]);

        const groupId = await createDmGroup(alice, bob.id);
        await insertMessage(groupId, alice.id, "private message");

        const carolClient = authenticateAs(carol);
        const { data, error } = await carolClient.rpc("get_dm_previews", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    });

    describe("get_unread_counts", () => {
      it("returns unread_count = 3 when bob sent 3 messages and alice has no read receipt", async () => {
        const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
        const groupId = await createDmGroup(alice, bob.id);

        await insertMessage(groupId, bob.id, "msg 1");
        await insertMessage(groupId, bob.id, "msg 2");
        await insertMessage(groupId, bob.id, "msg 3");

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_unread_counts", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        const rows = data as { group_id: string; unread_count: number }[];
        expect(rows).toHaveLength(1);
        expect(rows[0].group_id).toBe(groupId);
        expect(rows[0].unread_count).toBe(3);
      });

      it("returns no row after alice marks the conversation as read", async () => {
        const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
        const groupId = await createDmGroup(alice, bob.id);

        await insertMessage(groupId, bob.id, "msg 1");
        await insertMessage(groupId, bob.id, "msg 2");
        await insertMessage(groupId, bob.id, "msg 3");

        await upsertReadReceipt(alice.id, groupId, new Date().toISOString());

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_unread_counts", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it("returns unread_count = 1 after bob sends a new message post-read", async () => {
        const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
        const groupId = await createDmGroup(alice, bob.id);

        await insertMessage(groupId, bob.id, "old msg");
        await upsertReadReceipt(alice.id, groupId, new Date().toISOString());

        await new Promise((r) => setTimeout(r, 50));
        await insertMessage(groupId, bob.id, "new msg after read");

        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient.rpc("get_unread_counts", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        const rows = data as { group_id: string; unread_count: number }[];
        expect(rows).toHaveLength(1);
        expect(rows[0].unread_count).toBe(1);
      });

      it("RLS: outsider gets empty result for a DM group they are not in", async () => {
        const [alice, bob, carol] = await Promise.all([
          createTestUser(),
          createTestUser(),
          createTestUser(),
        ]);

        const groupId = await createDmGroup(alice, bob.id);
        await insertMessage(groupId, bob.id, "private msg");

        const carolClient = authenticateAs(carol);
        const { data, error } = await carolClient.rpc("get_unread_counts", {
          p_group_ids: [groupId],
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    });
  },
);
