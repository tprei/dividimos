import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  createAndActivateExpense,
  settleDebt,
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
  "RPC system messages in chat_messages",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let dmGroupId: string;
    let regularGroupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ handle: "sysmsg_alice" }),
        createTestUser({ handle: "sysmsg_bob" }),
      ]);

      // Create a DM group
      const dmGroup = await createTestGroupWithMembers(alice, [bob]);
      dmGroupId = dmGroup.id;
      await adminClient!
        .from("groups")
        .update({ is_dm: true })
        .eq("id", dmGroupId);

      // Create a regular group
      const regularGroup = await createTestGroupWithMembers(alice, [bob]);
      regularGroupId = regularGroup.id;
    });

    describe("activate_expense", () => {
      it("inserts a system_expense message for DM groups", async () => {
        const expenseId = await createAndActivateExpense({
          creator: alice,
          groupId: dmGroupId,
          shares: [
            { userId: alice.id, amount: 5000 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "DM expense test",
        });

        const messages = await getChatMessages(dmGroupId);
        const systemMsg = messages.find(
          (m) =>
            m.message_type === "system_expense" &&
            m.expense_id === expenseId,
        );

        expect(systemMsg).toBeTruthy();
        expect(systemMsg!.sender_id).toBe(alice.id);
        expect(systemMsg!.group_id).toBe(dmGroupId);
        expect(systemMsg!.settlement_id).toBeNull();
      });

      it("does NOT insert a system message for regular groups", async () => {
        const messagesBefore = await getChatMessages(regularGroupId);

        await createAndActivateExpense({
          creator: alice,
          groupId: regularGroupId,
          shares: [
            { userId: alice.id, amount: 3000 },
            { userId: bob.id, amount: 7000 },
          ],
          payers: [{ userId: alice.id, amount: 10000 }],
          title: "Regular group expense",
        });

        const messagesAfter = await getChatMessages(regularGroupId);
        expect(messagesAfter.length).toBe(messagesBefore.length);
      });

      it("system message is readable by both DM members", async () => {
        const expenseId = await createAndActivateExpense({
          creator: alice,
          groupId: dmGroupId,
          shares: [
            { userId: alice.id, amount: 2000 },
            { userId: bob.id, amount: 2000 },
          ],
          payers: [{ userId: bob.id, amount: 4000 }],
          title: "Readability test",
        });

        const bobClient = authenticateAs(bob);
        const { data, error } = await bobClient
          .from("chat_messages")
          .select("*")
          .eq("group_id", dmGroupId)
          .eq("expense_id", expenseId);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0].message_type).toBe("system_expense");
      });
    });

    describe("record_and_settle", () => {
      it("inserts a system_settlement message for DM groups", async () => {
        // First create an expense so there's a balance to settle
        await createAndActivateExpense({
          creator: alice,
          groupId: dmGroupId,
          shares: [
            { userId: alice.id, amount: 0 },
            { userId: bob.id, amount: 6000 },
          ],
          payers: [{ userId: alice.id, amount: 6000 }],
          title: "Pre-settlement expense",
        });

        const settlementId = await settleDebt({
          caller: bob,
          groupId: dmGroupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 3000,
        });

        const messages = await getChatMessages(dmGroupId);
        const systemMsg = messages.find(
          (m) =>
            m.message_type === "system_settlement" &&
            m.settlement_id === settlementId,
        );

        expect(systemMsg).toBeTruthy();
        expect(systemMsg!.sender_id).toBe(bob.id);
        expect(systemMsg!.group_id).toBe(dmGroupId);
        expect(systemMsg!.expense_id).toBeNull();
      });

      it("does NOT insert a system message for regular groups", async () => {
        // Create balance in regular group
        await createAndActivateExpense({
          creator: alice,
          groupId: regularGroupId,
          shares: [
            { userId: alice.id, amount: 0 },
            { userId: bob.id, amount: 5000 },
          ],
          payers: [{ userId: alice.id, amount: 5000 }],
          title: "Regular pre-settle",
        });

        const messagesBefore = await getChatMessages(regularGroupId);

        await settleDebt({
          caller: bob,
          groupId: regularGroupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 2000,
        });

        const messagesAfter = await getChatMessages(regularGroupId);
        expect(messagesAfter.length).toBe(messagesBefore.length);
      });

      it("sender_id matches the caller, not necessarily the debtor", async () => {
        // Alice settles on behalf (she's the creditor)
        await createAndActivateExpense({
          creator: alice,
          groupId: dmGroupId,
          shares: [
            { userId: alice.id, amount: 0 },
            { userId: bob.id, amount: 4000 },
          ],
          payers: [{ userId: alice.id, amount: 4000 }],
          title: "Creditor-initiated settle",
        });

        const settlementId = await settleDebt({
          caller: alice,
          groupId: dmGroupId,
          fromUserId: bob.id,
          toUserId: alice.id,
          amountCents: 1000,
        });

        const messages = await getChatMessages(dmGroupId);
        const systemMsg = messages.find(
          (m) => m.settlement_id === settlementId,
        );

        expect(systemMsg).toBeTruthy();
        expect(systemMsg!.sender_id).toBe(alice.id);
      });
    });
  },
);
