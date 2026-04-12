import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";
describe.skipIf(!isIntegrationTestReady)(
  "chat_messages RLS policies",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let dmGroupId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        createTestUser({ handle: "chat_alice" }),
        createTestUser({ handle: "chat_bob" }),
        createTestUser({ handle: "chat_carol" }),
      ]);

      // Create a DM group between alice and bob
      const group = await createTestGroupWithMembers(alice, [bob]);
      dmGroupId = group.id;

      // Mark it as DM
      await adminClient!
        .from("groups")
        .update({ is_dm: true })
        .eq("id", dmGroupId);
    });

    describe("INSERT", () => {
      it("allows accepted member to send a message", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: alice.id,
            message_type: "text",
            content: "Oi Bob!",
          })
          .select()
          .single();

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        expect(data!.content).toBe("Oi Bob!");
        expect(data!.sender_id).toBe(alice.id);
      });

      it("rejects insert with mismatched sender_id", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: bob.id, // Alice trying to impersonate Bob
            message_type: "text",
            content: "Spoofed message",
          });

        expect(error).toBeTruthy();
      });

      it("rejects insert from non-member", async () => {
        const carolClient = authenticateAs(carol);
        const { error } = await carolClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: carol.id,
            message_type: "text",
            content: "I shouldn't be here",
          });

        expect(error).toBeTruthy();
      });

      it("allows system_expense message with expense_id", async () => {
        const aliceClient = authenticateAs(alice);
        const { data, error } = await aliceClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: alice.id,
            message_type: "system_expense",
            content: "Nova conta: Uber R$25,00",
          })
          .select()
          .single();

        expect(error).toBeNull();
        expect(data!.message_type).toBe("system_expense");
      });
    });

    describe("SELECT", () => {
      it("allows group member to read messages", async () => {
        const bobClient = authenticateAs(bob);
        const { data, error } = await bobClient
          .from("chat_messages")
          .select("*")
          .eq("group_id", dmGroupId);

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        expect(data!.length).toBeGreaterThan(0);
      });

      it("prevents non-member from reading messages", async () => {
        const carolClient = authenticateAs(carol);
        const { data, error } = await carolClient
          .from("chat_messages")
          .select("*")
          .eq("group_id", dmGroupId);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    });

    describe("UPDATE", () => {
      let textMessageId: string;

      beforeAll(async () => {
        // Insert a text message from bob for update tests
        const { data } = await adminClient!
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: bob.id,
            message_type: "text",
            content: "Original message",
          })
          .select("id")
          .single();
        textMessageId = data!.id;
      });

      it("allows sender to update their own text message", async () => {
        const bobClient = authenticateAs(bob);
        const { error } = await bobClient
          .from("chat_messages")
          .update({ content: "Edited message" })
          .eq("id", textMessageId);

        expect(error).toBeNull();

        const { data } = await bobClient
          .from("chat_messages")
          .select("content")
          .eq("id", textMessageId)
          .single();
        expect(data!.content).toBe("Edited message");
      });

      it("prevents other member from updating the message", async () => {
        const aliceClient = authenticateAs(alice);
        const { data } = await aliceClient
          .from("chat_messages")
          .update({ content: "Hijacked" })
          .eq("id", textMessageId)
          .select();

        // RLS silently filters — no rows matched
        expect(data).toHaveLength(0);
      });
    });

    describe("DELETE", () => {
      it("allows sender to delete their own text message", async () => {
        const bobClient = authenticateAs(bob);

        // Insert a message to delete
        const { data: msg } = await bobClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: bob.id,
            message_type: "text",
            content: "To be deleted",
          })
          .select("id")
          .single();

        const { error } = await bobClient
          .from("chat_messages")
          .delete()
          .eq("id", msg!.id);

        expect(error).toBeNull();
      });

      it("prevents deleting system messages", async () => {
        // Insert a system message via admin
        const { data: sysMsg } = await adminClient!
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: alice.id,
            message_type: "system_expense",
            content: "System: expense created",
          })
          .select("id")
          .single();

        const aliceClient = authenticateAs(alice);
        const { data } = await aliceClient
          .from("chat_messages")
          .delete()
          .eq("id", sysMsg!.id)
          .select();

        // RLS blocks deletion of non-text messages
        expect(data).toHaveLength(0);
      });
    });

    describe("groups.is_dm column", () => {
      it("is_dm can be set to true on DM groups", async () => {
        const { data: adminData } = await adminClient!
          .from("groups")
          .select("is_dm")
          .eq("id", dmGroupId)
          .single();

        expect(adminData!.is_dm).toBe(true);
      });

      it("new groups default is_dm to false", async () => {
        const regularGroup = await createTestGroupWithMembers(alice, [bob]);

        const { data } = await adminClient!
          .from("groups")
          .select("is_dm")
          .eq("id", regularGroup.id)
          .single();

        expect(data!.is_dm).toBe(false);
      });
    });
  },
);
