import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createAndActivateExpense,
  settleDebt,
  getBalanceBetween,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

async function getChatMessages(groupId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await adminClient!
    .from("chat_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to query chat_messages: ${error.message}`);
  return (data ?? []) as ChatMessageRow[];
}

describe.skipIf(!isIntegrationTestReady)(
  "DM lifecycle: create → chat → expense → settle",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ handle: "lifecycle_alice" }),
        createTestUser({ handle: "lifecycle_bob" }),
      ]);
    });

    it("step 1: creates a DM group via RPC", async () => {
      const aliceClient = authenticateAs(alice);
      const { data, error } = await aliceClient.rpc(
        "get_or_create_dm_group",
        { p_other_user_id: bob.id },
      );

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      dmGroupId = data as string;

      // Verify group is marked as DM
      const { data: group } = await adminClient!
        .from("groups")
        .select("is_dm")
        .eq("id", dmGroupId)
        .single();
      expect(group!.is_dm).toBe(true);

      // Verify both users are accepted members
      const { data: members } = await adminClient!
        .from("group_members")
        .select("user_id, status")
        .eq("group_id", dmGroupId);
      expect(members).toHaveLength(2);
      expect(members!.every((m) => m.status === "accepted")).toBe(true);
    });

    it("step 2: both users can send text messages", async () => {
      const aliceClient = authenticateAs(alice);
      const bobClient = authenticateAs(bob);

      const { error: e1 } = await aliceClient.from("chat_messages").insert({
        group_id: dmGroupId,
        sender_id: alice.id,
        message_type: "text",
        content: "E aí Bob, pegamos Uber ontem",
      });
      expect(e1).toBeNull();

      const { error: e2 } = await bobClient.from("chat_messages").insert({
        group_id: dmGroupId,
        sender_id: bob.id,
        message_type: "text",
        content: "Verdade, quanto foi?",
      });
      expect(e2).toBeNull();

      const messages = await getChatMessages(dmGroupId);
      const textMessages = messages.filter((m) => m.message_type === "text");
      expect(textMessages).toHaveLength(2);
    });

    it("step 3: activating an expense inserts a system message", async () => {
      const expenseId = await createAndActivateExpense({
        creator: alice,
        groupId: dmGroupId,
        shares: [
          { userId: alice.id, amount: 1250 },
          { userId: bob.id, amount: 1250 },
        ],
        payers: [{ userId: alice.id, amount: 2500 }],
        title: "Uber",
      });

      const messages = await getChatMessages(dmGroupId);
      const expenseMsg = messages.find(
        (m) =>
          m.message_type === "system_expense" && m.expense_id === expenseId,
      );

      expect(expenseMsg).toBeTruthy();
      expect(expenseMsg!.sender_id).toBe(alice.id);

      // Balance should reflect the expense: bob owes alice 1250
      const balance = await getBalanceBetween(dmGroupId, bob.id, alice.id);
      expect(balance).toBe(1250);
    });

    it("step 4: settling the debt inserts a system message and updates balance", async () => {
      const settlementId = await settleDebt({
        caller: bob,
        groupId: dmGroupId,
        fromUserId: bob.id,
        toUserId: alice.id,
        amountCents: 1250,
      });

      const messages = await getChatMessages(dmGroupId);
      const settleMsg = messages.find(
        (m) =>
          m.message_type === "system_settlement" &&
          m.settlement_id === settlementId,
      );

      expect(settleMsg).toBeTruthy();
      expect(settleMsg!.sender_id).toBe(bob.id);

      // Balance should be zero after full settlement
      const balance = await getBalanceBetween(dmGroupId, bob.id, alice.id);
      expect(balance).toBe(0);
    });

    it("step 5: chat history shows all messages in chronological order", async () => {
      const messages = await getChatMessages(dmGroupId);

      // 2 text + 1 system_expense + 1 system_settlement = 4 messages
      expect(messages).toHaveLength(4);

      expect(messages[0].message_type).toBe("text");
      expect(messages[1].message_type).toBe("text");
      expect(messages[2].message_type).toBe("system_expense");
      expect(messages[3].message_type).toBe("system_settlement");

      // Chronological ordering
      for (let i = 1; i < messages.length; i++) {
        expect(
          new Date(messages[i].created_at).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(messages[i - 1].created_at).getTime(),
        );
      }
    });

    it("step 6: both members see the full conversation via RLS", async () => {
      const aliceClient = authenticateAs(alice);
      const bobClient = authenticateAs(bob);

      const [aliceResult, bobResult] = await Promise.all([
        aliceClient
          .from("chat_messages")
          .select("id")
          .eq("group_id", dmGroupId),
        bobClient
          .from("chat_messages")
          .select("id")
          .eq("group_id", dmGroupId),
      ]);

      expect(aliceResult.error).toBeNull();
      expect(bobResult.error).toBeNull();
      expect(aliceResult.data!.length).toBe(bobResult.data!.length);
      expect(aliceResult.data!.length).toBe(4);
    });
  },
);
