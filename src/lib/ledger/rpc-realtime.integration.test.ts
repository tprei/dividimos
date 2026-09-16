import { describe, expect, it } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  createGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";

// Real private-channel authorization against the installed Realtime service.
// A policy denial surfaces as a join that never completes: the server logs
// Unauthorized but sends no prompt client reply, so "denied" always means
// the joinOutcome timeout elapsed. Malformed topics must behave exactly like
// unauthorized ones — a denial, never an exception surfaced as a distinct
// transport failure.
describe.skipIf(!isIntegrationTestReady)("realtime topic authorization", () => {
  async function realtimeClient(user: TestUser): Promise<SupabaseClient<Database>> {
    if (!user.accessToken) {
      throw new Error(`User ${user.handle} has no access token`);
    }

    const accessToken = user.accessToken;
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { accessToken: async () => accessToken },
    );
    await client.realtime.setAuth(accessToken);
    return client;
  }

  function joinOutcome(channel: RealtimeChannel, timeoutMs = 8000): Promise<"subscribed" | "denied"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve("denied"), timeoutMs);
      channel
        .on("broadcast", { event: "probe" }, () => {})
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve("subscribed");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            clearTimeout(timer);
            resolve("denied");
          }
        });
    });
  }

  // Joins that must succeed retry with a fresh channel: a join issued while
  // the Realtime server is still warming its tenant connection is never
  // evaluated (the server logs nothing for it) and looks exactly like a
  // policy denial. Joins that must fail keep a single attempt.
  async function joinSubscribed(
    makeChannel: () => RealtimeChannel,
    attemptTimeoutMs = 5000,
    attempts = 12,
  ): Promise<RealtimeChannel> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const channel = makeChannel();
      const outcome = await joinOutcome(channel, attemptTimeoutMs);
      if (outcome === "subscribed") return channel;
      await channel.unsubscribe();
    }
    throw new Error(`expected subscribed, received denied after ${attempts} attempts`);
  }

  it("delivers to the owner's user topic and denies another user's", async () => {
    const [alice, bob] = await createTestUsers(2);
    const aliceClient = await realtimeClient(alice);

    const own = await joinSubscribed(
      () => aliceClient.channel(`user:${alice.id}`, { config: { private: true } }),
    );
    await own.unsubscribe();

    const other = aliceClient.channel(`user:${bob.id}`, { config: { private: true } });
    await expect(joinOutcome(other)).resolves.toBe("denied");
    await other.unsubscribe();
  }, 180000);

  it("delivers group and chat topics to accepted members only", async () => {
    const [alice, bruno, outsider] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const aliceClient = await realtimeClient(alice);
    const outsiderClient = await realtimeClient(outsider);

    const memberGroup = await joinSubscribed(
      () => aliceClient.channel(`group:${groupId}`, { config: { private: true } }),
    );
    await memberGroup.unsubscribe();

    const memberChat = await joinSubscribed(
      () => aliceClient.channel(`chat:${groupId}`, { config: { private: true } }),
    );
    await memberChat.unsubscribe();

    const outsiderGroup = outsiderClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(outsiderGroup)).resolves.toBe("denied");
    await outsiderGroup.unsubscribe();
  }, 180000);

  it("denies malformed topics as plain policy denials", async () => {
    const [alice] = await createTestUsers(1);
    const aliceClient = await realtimeClient(alice);
    const hyphens = "-".repeat(36);

    for (const topic of [
      `user:${hyphens}`,
      `group:${hyphens}`,
      `chat:${hyphens}`,
      `banana:${alice.id}`,
      `user:${alice.id.replace(/^[0-9a-f]/, "z")}`,
      "user:",
    ]) {
      const channel = aliceClient.channel(topic, { config: { private: true } });
      // All malformed shapes deny; none of them may raise a distinct
      // transport-level failure, so they resolve to the same outcome.
      await expect(joinOutcome(channel, 5000)).resolves.toBe("denied");
      await channel.unsubscribe();
    }
  }, 180000);

  it("denies a fresh join after membership ends", async () => {
    const [alice, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const brunoClient = await realtimeClient(bruno);

    const before = await joinSubscribed(
      () => brunoClient.channel(`group:${groupId}`, { config: { private: true } }),
    );
    await before.unsubscribe();

    const left = await brunoClient.rpc("leave_group", { p_group_id: groupId });
    expect(left.error).toBeNull();

    const after = brunoClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(after)).resolves.toBe("denied");
    await after.unsubscribe();
  }, 180000);
});
