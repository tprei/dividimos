import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BOT_SPECS, ensureTroupe, type Troupe } from "./bots";

// Production canary for the security fixes: every probe runs as the seeded
// bots, writes only inside a throwaway probe group, and cleans up in finally,
// so it is safe on the 30-minute schedule.

const PROTECTED_TABLES = [
  "users",
  "chat_messages",
  "push_subscriptions",
  "group_member_departures",
  "rate_limit_counters",
] as const;

const SERVICE_ONLY_RPCS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["delete_account", { p_user_id: "00000000-0000-4000-8000-000000000000" }],
  ["erase_chat_message", { p_message_id: "00000000-0000-4000-8000-000000000000" }],
  ["consume_ai_request", { p_user_id: "00000000-0000-4000-8000-000000000000" }],
  ["purge_realtime_message", { p_message_id: "00000000-0000-4000-8000-000000000000" }],
  [
    "is_former_member",
    {
      p_group_id: "00000000-0000-4000-8000-000000000000",
      p_user_id: "00000000-0000-4000-8000-000000000000",
    },
  ],
  [
    "claim_push_subscription",
    {
      p_user_id: "00000000-0000-4000-8000-000000000000",
      p_channel: "fcm",
      p_endpoint_digest: "probe",
      p_subscription_encrypted: "probe",
    },
  ],
];

const PROBE_GROUP_NAME = "Sonda de segurança (bots)";

let troupe: Troupe;
let anon: SupabaseClient;
const clients = new Map<string, SupabaseClient>();

function botClient(handle: string): SupabaseClient {
  const client = clients.get(handle);
  if (!client) throw new Error(`ambient: no client for ${handle}`);
  return client;
}

function botId(handle: string): string {
  const index = BOT_SPECS.findIndex((spec) => spec.handle === handle);
  return troupe.bots[index].id;
}

async function joinPrivate(client: SupabaseClient, topic: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const channel = client.channel(topic, { config: { private: true } });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      resolve(status);
    }
  });
  const outcome = await promise;
  await client.removeChannel(channel);
  return outcome;
}

function sessionClient(accessToken: string): SupabaseClient {
  const client = createClient(troupe.env.supabaseUrl, troupe.env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  client.realtime.setAuth(accessToken);
  return client;
}

beforeAll(async () => {
  troupe = await ensureTroupe();
  anon = createClient(troupe.env.supabaseUrl, troupe.env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  BOT_SPECS.forEach((spec, index) => {
    clients.set(spec.handle, sessionClient(troupe.bots[index].accessToken));
  });
});

afterAll(async () => {
  for (const client of clients.values()) {
    await client.removeAllChannels();
  }
});

describe("security canary", () => {
  it("refuses direct table reads for anon and bot sessions", async () => {
    for (const table of PROTECTED_TABLES) {
      const asAnon = await anon.from(table).select("*").limit(1);
      expect(asAnon.error, `anon read of ${table}`).not.toBeNull();
      const asBot = await botClient("bot_ana").from(table).select("*").limit(1);
      expect(asBot.error, `bot read of ${table}`).not.toBeNull();
    }
  });

  it("refuses service-only RPCs for bot sessions", async () => {
    for (const [fn, args] of SERVICE_ONLY_RPCS) {
      const { error } = await botClient("bot_ana").rpc(fn, args);
      expect(error?.message ?? "", fn).toMatch(/permission denied|Could not find the function/);
    }
  });

  it("admits a bot to its own user topic and refuses another bot's", async () => {
    const token = troupe.bots[BOT_SPECS.findIndex((spec) => spec.handle === "bot_ana")].accessToken;
    const own = await joinPrivate(sessionClient(token), `user:${botId("bot_ana")}`);
    expect(own).toBe("SUBSCRIBED");
    const other = await joinPrivate(sessionClient(token), `user:${botId("bot_bruno")}`);
    expect(other).toBe("CHANNEL_ERROR");
  });

  it("keeps a creator's block effective on side doors and uncapped settlements", async () => {
    const ana = botClient("bot_ana");
    const carla = botClient("bot_carla");
    const elisa = botClient("bot_elisa");
    const { data: created, error: createError } = await ana.rpc("create_group", {
      p_name: PROBE_GROUP_NAME,
      p_member_ids: [botId("bot_carla")],
    });
    expect(createError).toBeNull();
    const groupId = (created as { groupId: string }).groupId;

    try {
      expect((await carla.rpc("accept_invitation", { p_group_id: groupId })).error).toBeNull();
      expect((await ana.rpc("block_user", { p_user_id: botId("bot_elisa") })).error).toBeNull();

      const { data: link, error: linkError } = await carla.rpc("create_invite_link", {
        p_group_id: groupId,
      });
      expect(linkError).toBeNull();
      const joined = await elisa.rpc("join_via_link", {
        p_token: (link as { token: string }).token,
      });
      expect(joined.error?.message).toBe("member_excluded");

      expect((await ana.rpc("block_user", { p_user_id: botId("bot_carla") })).error).toBeNull();
      const overpay = await carla.rpc("record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_from_user_id: botId("bot_carla"),
        p_to_user_id: botId("bot_ana"),
        p_amount_cents: 1,
        p_allow_overpay: true,
      });
      expect(overpay.error?.message).toBe("member_excluded");
    } finally {
      await ana.rpc("unblock_user", { p_user_id: botId("bot_elisa") });
      await ana.rpc("unblock_user", { p_user_id: botId("bot_carla") });
      await ana.rpc("delete_group", { p_group_id: groupId });
    }
  });
});
