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
// A channel join either reaches SUBSCRIBED or ends in an error/closed state;
// malformed topics must behave exactly like unauthorized ones — a denial,
// never an exception surfaced as a distinct transport failure.
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

  it("delivers to the owner's user topic and denies another user's", async () => {
    const [alice, bob] = await createTestUsers(2);
    const aliceClient = await realtimeClient(alice);

    const own = aliceClient.channel(`user:${alice.id}`, { config: { private: true } });
    await expect(joinOutcome(own)).resolves.toBe("subscribed");
    await own.unsubscribe();

    const other = aliceClient.channel(`user:${bob.id}`, { config: { private: true } });
    await expect(joinOutcome(other)).resolves.toBe("denied");
    await other.unsubscribe();
  });

  it("delivers group and chat topics to accepted members only", async () => {
    const [alice, bruno, outsider] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const aliceClient = await realtimeClient(alice);
    const outsiderClient = await realtimeClient(outsider);

    const memberGroup = aliceClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(memberGroup)).resolves.toBe("subscribed");
    await memberGroup.unsubscribe();

    const memberChat = aliceClient.channel(`chat:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(memberChat)).resolves.toBe("subscribed");
    await memberChat.unsubscribe();

    const outsiderGroup = outsiderClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(outsiderGroup)).resolves.toBe("denied");
    await outsiderGroup.unsubscribe();
  });

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
  });

  it("denies a fresh join after membership ends", async () => {
    const [alice, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const brunoClient = await realtimeClient(bruno);

    const before = brunoClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(before)).resolves.toBe("subscribed");
    await before.unsubscribe();

    const left = await brunoClient.rpc("leave_group", { p_group_id: groupId });
    expect(left.error).toBeNull();

    const after = brunoClient.channel(`group:${groupId}`, { config: { private: true } });
    await expect(joinOutcome(after)).resolves.toBe("denied");
    await after.unsubscribe();
  });
});
