import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SeedHelper, type SeededUser } from "../e2e/seed-helper";
import { type AmbientEnv, readAmbientEnv } from "./env";

export interface BotSpec {
  handle: string;
  name: string;
}

export const BOT_SPECS: readonly BotSpec[] = [
  { handle: "bot_ana", name: "Ana (bot)" },
  { handle: "bot_bruno", name: "Bruno (bot)" },
  { handle: "bot_carla", name: "Carla (bot)" },
  { handle: "bot_diego", name: "Diego (bot)" },
  { handle: "bot_elisa", name: "Elisa (bot)" },
] as const;

export const BOT_EMAIL_DOMAIN = "bots.dividimos.ai";
export const BOT_GROUP_NAME = "Bots da casa";
export const MAX_ACTIVE_BOT_EXPENSES = 60;

export interface Troupe {
  env: AmbientEnv;
  admin: SupabaseClient;
  seed: SeedHelper;
  bots: SeededUser[];
  groupId: string;
}

interface ActiveExpense {
  id: string;
  creator_id: string;
  created_at: string;
}

export async function pruneOldExpenses(troupe: Troupe): Promise<number> {
  const { data, error } = await troupe.admin
    .from("expenses")
    .select("id,creator_id,created_at")
    .eq("group_id", troupe.groupId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .returns<ActiveExpense[]>();

  if (error) {
    throw new Error(`ambient: list active expenses failed: ${error.message}`);
  }

  const rows = [...(data ?? [])];
  let deleted = 0;
  while (rows.length > MAX_ACTIVE_BOT_EXPENSES) {
    const oldest = rows[0];
    const client = await troupe.seed.authenticateAs(oldest.creator_id);
    const { error: deleteError } = await client.rpc("delete_expense", {
      p_expense_id: oldest.id,
    });
    if (deleteError) {
      throw new Error(`ambient: delete_expense failed: ${deleteError.message}`);
    }
    rows.shift();
    deleted++;
  }

  return deleted;
}

interface UserRow {
  id: string;
  handle: string;
  name: string;
  is_bot: boolean;
}

interface GroupRow {
  id: string;
}

interface GroupMemberRow {
  user_id: string;
  status: string;
}

async function ensureBot(
  admin: SupabaseClient,
  seed: SeedHelper,
  spec: BotSpec,
): Promise<SeededUser> {
  const email = `${spec.handle}@${BOT_EMAIL_DOMAIN}`;

  const { data: existingUser, error: lookupError } = await admin
    .from("users")
    .select("id,handle,name,is_bot")
    .eq("email", email)
    .maybeSingle<UserRow>();

  if (lookupError) {
    throw new Error(`ambient: lookup bot user (${email}) failed: ${lookupError.message}`);
  }

  let row = existingUser;
  if (!row) {
    const { error: createAuthError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: spec.name },
    });
    if (createAuthError) {
      throw new Error(`ambient: createUser (${email}) failed: ${createAuthError.message}`);
    }

    const { data: reselectedUser, error: reselectError } = await admin
      .from("users")
      .select("id,handle,name,is_bot")
      .eq("email", email)
      .maybeSingle<UserRow>();

    if (reselectError) {
      throw new Error(`ambient: re-select bot user (${email}) failed: ${reselectError.message}`);
    }
    if (!reselectedUser) {
      throw new Error(`ambient: user profile (${email}) missing after createUser`);
    }

    row = reselectedUser;
  }

  // The handle_new_user trigger suffixes digits on collision; a bot must never squat a real user's handle.
  if (row.handle !== spec.handle) {
    throw new Error(`ambient: ${email} has handle ${row.handle}, expected ${spec.handle}`);
  }

  const handleWithoutPrefix = spec.handle.replace(/^bot_/, "");
  const pixKeyHint = `${handleWithoutPrefix.slice(0, 3)}***@${BOT_EMAIL_DOMAIN}`;

  if (!row.is_bot || row.name !== spec.name) {
    const { error: updateError } = await admin
      .from("users")
      .update({
        is_bot: true,
        onboarded: true,
        name: spec.name,
        pix_key_type: "email",
        pix_key_hint: pixKeyHint,
      })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`ambient: update bot user (${email}) failed: ${updateError.message}`);
    }
  }

  const accessToken = await seed.mintAccessToken(row.id, email);
  const botUser: SeededUser = {
    id: row.id,
    email,
    handle: spec.handle,
    name: spec.name,
    pixKeyType: "email",
    pixKeyHint,
    onboarded: true,
    isBot: true,
    accessToken,
    refreshToken: "noop",
  };

  seed.registerSession(botUser);
  return botUser;
}

export async function ensureTroupe(): Promise<Troupe> {
  const env = readAmbientEnv();

  // SeedHelper reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  // and SUPABASE_JWT_SECRET at construction; E2E_BASE_URL is read by
  // loginInContext in e2e/fixtures.ts at call time for the web spec.
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
  process.env.SUPABASE_JWT_SECRET = env.jwtSecret;
  process.env.E2E_BASE_URL = env.baseUrl;

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const seed = new SeedHelper(admin);

  const bots: SeededUser[] = [];
  for (const spec of BOT_SPECS) {
    bots.push(await ensureBot(admin, seed, spec));
  }

  const { data: groupRow, error: groupQueryError } = await admin
    .from("groups")
    .select("id")
    .eq("creator_id", bots[0].id)
    .eq("kind", "group")
    .eq("name", BOT_GROUP_NAME)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<GroupRow>();

  if (groupQueryError) {
    throw new Error(`ambient: lookup group failed: ${groupQueryError.message}`);
  }

  let groupId = groupRow?.id;
  if (!groupId) {
    const otherIds = bots.slice(1).map((bot) => bot.id);
    const group = await seed.createGroup(bots[0].id, otherIds, BOT_GROUP_NAME);
    groupId = group.id;
  }

  const { data: memberRows, error: membersError } = await admin
    .from("group_members")
    .select("user_id,status")
    .eq("group_id", groupId)
    .returns<GroupMemberRow[]>();

  if (membersError) {
    throw new Error(`ambient: lookup group_members failed: ${membersError.message}`);
  }

  const statusByUserId = new Map<string, string>();
  for (const row of memberRows ?? []) {
    statusByUserId.set(row.user_id, row.status);
  }

  // The creator (bots[0]) is already 'accepted', so skip it.
  for (const bot of bots.slice(1)) {
    if (!statusByUserId.has(bot.id)) {
      await seed.inviteMember(bots[0].id, groupId, bot.id);
      statusByUserId.set(bot.id, "invited");
    }
    if (statusByUserId.get(bot.id) !== "accepted") {
      const client = await seed.authenticateAs(bot.id);
      const { error: acceptError } = await client.rpc("accept_invitation", {
        p_group_id: groupId,
      });
      if (acceptError) {
        throw new Error(
          `ambient: accept_invitation failed for bot ${bot.handle} (${bot.id}): ${acceptError.message}`,
        );
      }
      statusByUserId.set(bot.id, "accepted");
    }
  }

  return { env, admin, seed, bots, groupId };
}
