import { describe, it, expect, beforeAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  createTestDmGroup,
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
      const group = await createTestDmGroup(alice, bob);
      dmGroupId = group.id;
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

      it("rejects direct insert of system_settlement message_type", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: alice.id,
            message_type: "system_settlement",
            content: "fake",
          });

        expect(error).toBeTruthy();
      });

      it("rejects direct insert of system_expense message_type", async () => {
        const aliceClient = authenticateAs(alice);
        const { error } = await aliceClient
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: alice.id,
            message_type: "system_expense",
            content: "forged expense",
          });

        expect(error).toBeTruthy();
      });

      it("canonical invited DM member cannot direct-insert; only #472's accepted-member INSERT succeeds", async () => {
        const invitee = await createTestUser({ name: "Chat Canonical Invitee" });
        const invitedDm = await createTestDmGroup(alice, invitee, { bothAccepted: false });

        const inviteeClient = authenticateAs(invitee);
        const { data, error } = await inviteeClient
          .from("chat_messages")
          .insert({
            group_id: invitedDm.id,
            sender_id: invitee.id,
            message_type: "text",
            content: "not yet accepted",
          });

        expect(error).toBeTruthy();
        expect(data).toBeNull();

        const { data: rows } = await adminClient!
          .from("chat_messages")
          .select("id")
          .eq("group_id", invitedDm.id);
        expect(rows).toHaveLength(0);
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

    describe("append-only: direct UPDATE and DELETE are denied", () => {
      let textMessageId: string;
      let snapshotBefore: Record<string, unknown>;

      beforeAll(async () => {
        const { data } = await adminClient!
          .from("chat_messages")
          .insert({
            group_id: dmGroupId,
            sender_id: bob.id,
            message_type: "text",
            content: "Original message",
          })
          .select("*")
          .single();
        textMessageId = data!.id;
        snapshotBefore = data as unknown as Record<string, unknown>;
      });

      async function expectRowUnchanged() {
        const { data } = await adminClient!
          .from("chat_messages")
          .select("*")
          .eq("id", textMessageId)
          .single();
        expect(data).toEqual(snapshotBefore);
      }

      it("42501s a table-driven UPDATE of every direct column, row unchanged after each", async () => {
        const bobClient = authenticateAs(bob);
        const otherGroup = await createTestGroupWithMembers(alice, [bob]);
        const attempts: Record<string, unknown>[] = [
          { id: crypto.randomUUID() },
          { group_id: otherGroup.id },
          { sender_id: alice.id },
          { message_type: "system_expense" },
          { content: "forged content" },
          { expense_id: crypto.randomUUID() },
          { settlement_id: crypto.randomUUID() },
          { created_at: new Date("2020-01-01").toISOString() },
        ];

        for (const attempt of attempts) {
          const { error } = await bobClient
            .from("chat_messages")
            .update(attempt)
            .eq("id", textMessageId);
          expect(error).not.toBeNull();
          expect(error!.code).toBe("42501");
          await expectRowUnchanged();
        }
      });

      it("42501s relocation to a known foreign regular group the sender is absent from", async () => {
        const attacker = await createTestUser({ name: "Chat Attacker" });
        const source = await createTestGroupWithMembers(alice, [attacker]);
        const { data: sourceMsg } = await adminClient!
          .from("chat_messages")
          .insert({ group_id: source.id, sender_id: attacker.id, message_type: "text", content: "mine" })
          .select("*")
          .single();

        const destination = await createTestGroupWithMembers(alice, [bob]);

        const attackerClient = authenticateAs(attacker);
        const { error } = await attackerClient
          .from("chat_messages")
          .update({ group_id: destination.id })
          .eq("id", sourceMsg!.id);

        expect(error).not.toBeNull();
        expect(error!.code).toBe("42501");

        const { data: destRows } = await adminClient!
          .from("chat_messages")
          .select("id")
          .eq("group_id", destination.id);
        expect(destRows).toHaveLength(0);

        const { data: sourceAfter } = await adminClient!
          .from("chat_messages")
          .select("*")
          .eq("id", sourceMsg!.id)
          .single();
        expect(sourceAfter).toEqual(sourceMsg);
      });

      it("42501s relocation to a known canonical DM the sender is not part of", async () => {
        const attacker = await createTestUser({ name: "Chat DM Attacker" });
        const source = await createTestGroupWithMembers(alice, [attacker]);
        const { data: sourceMsg } = await adminClient!
          .from("chat_messages")
          .insert({ group_id: source.id, sender_id: attacker.id, message_type: "text", content: "mine" })
          .select("*")
          .single();

        const [carolTwo, dave] = await Promise.all([
          createTestUser({ name: "Foreign DM A" }),
          createTestUser({ name: "Foreign DM B" }),
        ]);
        const foreignDm = await createTestDmGroup(carolTwo, dave);

        const attackerClient = authenticateAs(attacker);
        const { error } = await attackerClient
          .from("chat_messages")
          .update({ group_id: foreignDm.id })
          .eq("id", sourceMsg!.id);

        expect(error).not.toBeNull();
        expect(error!.code).toBe("42501");

        const { data: destRows } = await adminClient!
          .from("chat_messages")
          .select("id")
          .eq("group_id", foreignDm.id);
        expect(destRows).toHaveLength(0);
      });

      it("42501s an unfiltered DELETE; row remains", async () => {
        const solo = await createTestUser({ name: "Chat Solo Sender" });
        const soloGroup = await createTestGroupWithMembers(alice, [solo]);
        const { data: soloMsg } = await adminClient!
          .from("chat_messages")
          .insert({ group_id: soloGroup.id, sender_id: solo.id, message_type: "text", content: "solo" })
          .select("id")
          .single();

        const soloClient = authenticateAs(solo);
        // Filter by sender_id (not the primary key) so PostgREST's own
        // empty-mutation guard doesn't mask the ACL denial under test.
        const { error } = await soloClient
          .from("chat_messages")
          .delete()
          .eq("sender_id", solo.id);

        expect(error).not.toBeNull();
        expect(error!.code).toBe("42501");

        const { data: after } = await adminClient!
          .from("chat_messages")
          .select("id")
          .eq("id", soloMsg!.id);
        expect(after).toHaveLength(1);
      });

      it("42501s UPDATE/DELETE from another member, an invited member, anon, and service_role", async () => {
        // another accepted member
        const aliceClient = authenticateAs(alice);
        const { error: aliceUpdateError } = await aliceClient
          .from("chat_messages")
          .update({ content: "hijacked" })
          .eq("id", textMessageId);
        expect(aliceUpdateError).not.toBeNull();
        expect(aliceUpdateError!.code).toBe("42501");

        const { error: aliceDeleteError } = await aliceClient
          .from("chat_messages")
          .delete()
          .eq("id", textMessageId);
        expect(aliceDeleteError).not.toBeNull();
        expect(aliceDeleteError!.code).toBe("42501");

        // invited (not yet accepted) member
        const invitee = await createTestUser({ name: "Chat Invitee" });
        const invitedGroup = await createTestDmGroup(alice, invitee, { bothAccepted: false });
        void invitedGroup;
        const inviteeClient = authenticateAs(invitee);
        const { error: inviteeUpdateError } = await inviteeClient
          .from("chat_messages")
          .update({ content: "hijacked" })
          .eq("id", textMessageId);
        expect(inviteeUpdateError).not.toBeNull();
        expect(inviteeUpdateError!.code).toBe("42501");

        // anon
        const { createClient } = await import("@supabase/supabase-js");
        const anonClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false } },
        );
        const { error: anonUpdateError } = await anonClient
          .from("chat_messages")
          .update({ content: "hijacked" })
          .eq("id", textMessageId);
        expect(anonUpdateError).not.toBeNull();
        expect(anonUpdateError!.code).toBe("42501");

        // service_role, despite BYPASSRLS
        const { error: serviceUpdateError } = await adminClient!
          .from("chat_messages")
          .update({ content: "hijacked" })
          .eq("id", textMessageId);
        expect(serviceUpdateError).not.toBeNull();
        expect(serviceUpdateError!.code).toBe("42501");

        const { error: serviceDeleteError } = await adminClient!
          .from("chat_messages")
          .delete()
          .eq("id", textMessageId);
        expect(serviceDeleteError).not.toBeNull();
        expect(serviceDeleteError!.code).toBe("42501");

        await expectRowUnchanged();
      });

      it("42501s UPDATE/DELETE after the sender has left the group (membership loss grants no child mutation)", async () => {
        const leaver = await createTestUser({ name: "Chat Leaver" });
        const leaverGroup = await createTestGroupWithMembers(alice, [leaver]);
        const { data: leaverMsg } = await adminClient!
          .from("chat_messages")
          .insert({ group_id: leaverGroup.id, sender_id: leaver.id, message_type: "text", content: "before leave" })
          .select("*")
          .single();

        const leaverClient = authenticateAs(leaver);
        const { error: leaveError } = await leaverClient.rpc("leave_group", { p_group_id: leaverGroup.id });
        expect(leaveError).toBeNull();

        const { error: updateAfterLeave } = await leaverClient
          .from("chat_messages")
          .update({ content: "still trying" })
          .eq("id", leaverMsg!.id);
        expect(updateAfterLeave).not.toBeNull();
        expect(updateAfterLeave!.code).toBe("42501");

        const { error: deleteAfterLeave } = await leaverClient
          .from("chat_messages")
          .delete()
          .eq("id", leaverMsg!.id);
        expect(deleteAfterLeave).not.toBeNull();
        expect(deleteAfterLeave!.code).toBe("42501");

        const { data: after } = await adminClient!
          .from("chat_messages")
          .select("*")
          .eq("id", leaverMsg!.id)
          .single();
        expect(after).toEqual(leaverMsg);
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
