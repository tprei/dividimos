import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SeedHelper, type SeededUser } from "../e2e/seed-helper";
import { decodeGroupSnapshot } from "../src/lib/ledger/decode";
import { transfersFromBalances } from "../src/lib/ledger/transfers";
import { note } from "./diary";
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

const BOT_EMAIL_DOMAIN = "bots.dividimos.ai";
export const BOT_GROUP_NAME = "Bots da casa";
export const MAX_ACTIVE_BOT_EXPENSES = 60;

// The human who watches the troupe. He joins a bot group while it still owes
// something and is removed once it is square, so a finished group stops
// showing up in his app. Override with AMBIENT_OWNER_HANDLE, or set it empty
// to keep every bot group private.
export const OWNER_HANDLE = process.env.AMBIENT_OWNER_HANDLE ?? "tprei";

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

// How long a bot group keeps history. The canary runs every 30 minutes, so
// without a sweep the group gains roughly 48 expenses, events and chat lines
// a day and never gives any back. A week still covers reading a weekend
// failure on Monday.
const HISTORY_RETENTION_DAYS = 7;
// Chat has no cap of its own, and the walk leaves one line per run.
export const MAX_CHAT_MESSAGES = 200;
// One run's worth of deletes, so a long-neglected group shrinks over several
// runs instead of issuing one enormous statement.
const SWEEP_BATCH = 500;

export interface SweptHistory {
  expenses: number;
  events: number;
  messages: number;
}

/**
 * Hard-deletes what the soft-delete path leaves behind. `delete_expense` only
 * flips status, so every pruned expense keeps its versions and participants
 * forever, and nothing at all prunes events or chat.
 *
 * Balances cannot move here: `current_expense_participants` ends
 * `WHERE e.status = 'active'`, so an expense this removes already counted for
 * nothing. Settlements are left alone, because deleting a confirmed one would
 * change a balance.
 */
async function sweepGroupHistory(
  troupe: Troupe,
  groupId: string,
): Promise<SweptHistory> {
  const cutoff = new Date(
    Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const stale = await troupe.admin
    .from("expenses")
    .select("id")
    .eq("group_id", groupId)
    .eq("status", "deleted")
    .lt("deleted_at", cutoff)
    .limit(SWEEP_BATCH)
    .returns<{ id: string }[]>();
  if (stale.error) {
    throw new Error(`ambient: list deleted expenses failed: ${stale.error.message}`);
  }

  const expenseIds = (stale.data ?? []).map((row) => row.id);
  if (expenseIds.length > 0) {
    // expense_versions and the participant rows cascade. group_events keeps
    // its row with a null expense_id, which the event sweep below collects.
    const { error } = await troupe.admin.from("expenses").delete().in("id", expenseIds);
    if (error) {
      throw new Error(`ambient: delete old expenses failed: ${error.message}`);
    }
  }

  const events = await troupe.admin
    .from("group_events")
    .delete()
    .eq("group_id", groupId)
    .lt("created_at", cutoff)
    .select("id")
    .returns<{ id: number }[]>();
  if (events.error) {
    throw new Error(`ambient: delete old events failed: ${events.error.message}`);
  }

  const messages = await sweepChat(troupe, groupId);

  return {
    expenses: expenseIds.length,
    events: (events.data ?? []).length,
    messages,
  };
}

/**
 * Sweeps every group a bot created: the house group, the journey pool, and
 * anything a later probe adds. Creator is the filter rather than membership,
 * because the owner joins bot groups and bots never join his.
 */
export async function sweepBotGroups(troupe: Troupe): Promise<SweptHistory> {
  const botIds = troupe.bots.map((bot) => bot.id);
  const { data, error } = await troupe.admin
    .from("groups")
    .select("id")
    .in("creator_id", botIds)
    .returns<{ id: string }[]>();
  if (error) {
    throw new Error(`ambient: list bot groups failed: ${error.message}`);
  }

  const total: SweptHistory = { expenses: 0, events: 0, messages: 0 };
  for (const group of data ?? []) {
    const swept = await sweepGroupHistory(troupe, group.id);
    total.expenses += swept.expenses;
    total.events += swept.events;
    total.messages += swept.messages;
  }
  return total;
}

/** Keeps the newest MAX_CHAT_MESSAGES lines and drops the rest. */
async function sweepChat(troupe: Troupe, groupId: string): Promise<number> {
  const listed = await troupe.admin
    .from("chat_messages")
    .select("id")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGES + SWEEP_BATCH - 1)
    .returns<{ id: string }[]>();
  if (listed.error) {
    throw new Error(`ambient: list chat messages failed: ${listed.error.message}`);
  }

  const ids = (listed.data ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;

  // conversation_reads.last_read_message_id has no cascade, so a read pointer
  // into one of these lines would block the delete. The unread count reads
  // last_read_at, so dropping the pointer costs nothing.
  const cleared = await troupe.admin
    .from("conversation_reads")
    .update({ last_read_message_id: null })
    .eq("group_id", groupId)
    .in("last_read_message_id", ids);
  if (cleared.error) {
    throw new Error(`ambient: clear read pointers failed: ${cleared.error.message}`);
  }

  const { error } = await troupe.admin.from("chat_messages").delete().in("id", ids);
  if (error) {
    throw new Error(`ambient: delete chat messages failed: ${error.message}`);
  }

  return ids.length;
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

  const troupe: Troupe = { env, admin, seed, bots, groupId };

  const owner = await syncOwnerMembership(troupe, groupId);
  if (owner === "joined") {
    note(`@${OWNER_HANDLE} joined ${BOT_GROUP_NAME} to watch the bots`);
  } else if (owner === "removed") {
    note(`${BOT_GROUP_NAME} is square, so @${OWNER_HANDLE} was let go`);
  }

  return troupe;
}

interface OwnerRow {
  id: string;
  handle: string;
  name: string;
}

interface MemberStatusRow {
  status: string;
}

/**
 * The owner is a real account this helper never created, so its session has
 * to be minted and adopted before any RPC can run as him. Without that,
 * authenticateAs has nothing cached and throws.
 */
async function acceptAsOwner(
  troupe: Troupe,
  groupId: string,
  ownerId: string,
): Promise<void> {
  const ownerClient = await troupe.seed.authenticateAs(ownerId);
  const { error } = await ownerClient.rpc("accept_invitation", {
    p_group_id: groupId,
  });
  if (error) {
    throw new Error(`ambient: owner accept_invitation failed: ${error.message}`);
  }
}

async function findOwner(troupe: Troupe): Promise<SeededUser | null> {
  if (OWNER_HANDLE.length === 0) return null;
  const { data, error } = await troupe.admin
    .from("users")
    .select("id,handle,name")
    .eq("handle", OWNER_HANDLE)
    .maybeSingle<OwnerRow>();
  if (error) {
    throw new Error(`ambient: lookup owner @${OWNER_HANDLE} failed: ${error.message}`);
  }
  if (!data) return null;

  const { data: authUser, error: authError } = await troupe.admin.auth.admin.getUserById(data.id);
  if (authError) {
    throw new Error(`ambient: read owner auth record failed: ${authError.message}`);
  }
  const email = authUser?.user?.email;
  if (!email) return null;

  const owner: SeededUser = {
    id: data.id,
    email,
    handle: data.handle,
    name: data.name,
    // Only the session matters here; the troupe never reads the owner's Pix.
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    isBot: false,
    accessToken: await troupe.seed.mintAccessToken(data.id, email),
    refreshToken: "noop",
  };
  troupe.seed.registerSession(owner);
  return owner;
}

/**
 * A group is settled when nobody owes anybody: recompute_group_balances keeps
 * a row only for a participant with a non-zero net, so no user rows means
 * square. That is the condition for letting the owner go.
 */
async function isSettled(troupe: Troupe, groupId: string): Promise<boolean> {
  const { count, error } = await troupe.admin
    .from("group_balances")
    .select("participant_id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("kind", "user");
  if (error) {
    throw new Error(`ambient: count balances failed: ${error.message}`);
  }
  return (count ?? 0) === 0;
}

/**
 * Settles whatever the owner owes or is owed in this group.
 *
 * He is a member so that he can watch, not so that he can carry a debt, and
 * an earlier version of the filmed walk accepted the wizard's default of
 * every member and put him on a pizza. His side is cleared here: he pays his
 * own debts, since only the debtor may record a settlement, and a bot pays
 * the ones owed to him.
 */
async function clearOwnerBalance(
  troupe: Troupe,
  groupId: string,
  owner: SeededUser,
): Promise<number> {
  let cleared = 0;
  for (let round = 0; round < BOT_SPECS.length * 2; round++) {
    const client = await troupe.seed.authenticateAs(owner.id);
    const { data, error } = await client.rpc("get_group", { p_group_id: groupId });
    if (error) {
      throw new Error(`ambient: owner get_group failed: ${error.message}`);
    }
    const decoded = decodeGroupSnapshot(data);
    if (!decoded.ok) {
      throw new Error(`ambient: owner snapshot rejected at ${decoded.issue.path.join(".")}`);
    }
    const transfer = transfersFromBalances(decoded.value.balances).find(
      (candidate) => candidate.fromId === owner.id || candidate.toId === owner.id,
    );
    if (!transfer) break;

    const payerId = transfer.fromId;
    const payerClient = await troupe.seed.authenticateAs(payerId);
    const { error: settleError } = await payerClient.rpc("record_settlement", {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: transfer.fromId,
      p_to_user_id: transfer.toId,
      p_amount_cents: transfer.amountCents,
    });
    if (settleError) {
      throw new Error(`ambient: clearing the owner's balance failed: ${settleError.message}`);
    }
    cleared += 1;
  }
  return cleared;
}

/**
 * Keeps the owner in a bot group exactly while it has money in flight: joins
 * him when there is something to watch, removes him once the group is square
 * so it leaves his list. Returns what happened, for the run diary.
 *
 * Reads and writes go through the same RPCs a person's app would call, so the
 * membership row, the events, and the broadcasts are the real thing. The
 * owner's own session is minted for the one call only he may make, accepting
 * his invitation.
 */
export async function syncOwnerMembership(
  troupe: Troupe,
  groupId: string,
): Promise<"joined" | "removed" | "watching" | "absent" | "skipped"> {
  const owner = await findOwner(troupe);
  if (owner === null) return "absent";
  const ownerId = owner.id;

  const { data: memberRow, error: memberError } = await troupe.admin
    .from("group_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", ownerId)
    .maybeSingle<MemberStatusRow>();
  if (memberError) {
    throw new Error(`ambient: lookup owner membership failed: ${memberError.message}`);
  }

  const settled = await isSettled(troupe, groupId);

  // Inviting and accepting are two calls, so a run that dies between them
  // leaves the invitation hanging. Accepting is driven by the row's status
  // rather than by having just created it, which also repairs a stuck invite.
  if (memberRow === null) {
    // An empty group has nothing to show yet, and a settled one is already
    // over: joining either would only add noise.
    if (settled) return "skipped";
    await troupe.seed.inviteMember(troupe.bots[0].id, groupId, ownerId);
    await acceptAsOwner(troupe, groupId, ownerId);
    return "joined";
  }

  if (memberRow.status === "invited") {
    await acceptAsOwner(troupe, groupId, ownerId);
    return "joined";
  }

  if (!settled) {
    const cleared = await clearOwnerBalance(troupe, groupId, owner);
    if (cleared > 0) {
      note(`Cleared ${cleared} balance${cleared === 1 ? "" : "s"} @${OWNER_HANDLE} should never have had`);
    }
    return "watching";
  }

  const creatorClient = await troupe.seed.authenticateAs(troupe.bots[0].id);
  const { error: removeError } = await creatorClient.rpc("remove_member", {
    p_group_id: groupId,
    p_user_id: ownerId,
  });
  if (removeError) {
    // The RPC guards the same condition from inside the transaction, so a
    // balance created between the check and the call keeps him in.
    if (removeError.message === "outstanding_balance") return "watching";
    throw new Error(`ambient: remove_member failed: ${removeError.message}`);
  }
  return "removed";
}
