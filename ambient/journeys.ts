import { createHash } from "node:crypto";
import type { SeededUser } from "../e2e/seed-helper";
import { formatBRL } from "../src/lib/currency";
import { decodeGroupSnapshot } from "../src/lib/ledger/decode";
import { transfersFromBalances } from "../src/lib/ledger/transfers";
import type { LedgerFact } from "../src/lib/ledger/model";
import { type EpisodePlan, factsAfter, planEpisode, type WalkAction } from "../src/lib/ledger/walk";
import { compareToModel, WalkRun } from "../src/test/walk-driver";
import type { Troupe } from "./bots";
import { replayTrip } from "./trips";
import { firstName, note } from "./diary";

/**
 * Journeys: one self-contained episode per ambient run.
 *
 * A run picks a journey group, plans a seeded journey with the in-memory
 * walker, executes it through the same RPCs a phone would call, and checks
 * production against the model after every single write. The episode ends by
 * settling every balance back to zero, so the group is clean for the next
 * one and "reset" means something even though production can never forget:
 * delete_group refuses any group that carries financial history.
 *
 * Groups cycle through a small pool instead of accumulating. A new one is
 * created only while the pool is short, which still exercises create_group
 * and accept_invitation from time to time.
 */

export const JOURNEY_GROUP_PREFIX = "Jornada dos bots";
export const JOURNEY_POOL_SIZE = 4;
export const JOURNEY_MEMBER_COUNT = 4;
export const JOURNEY_STEPS = 8;
// Episodes never remove what they wrote, so a reused group is trimmed back
// before each one. That keeps every projection the group has to compute, and
// the model that mirrors it, a fixed size.
export const JOURNEY_ACTIVE_EXPENSE_CAP = 24;

export interface Journey {
  groupId: string;
  groupName: string;
  members: SeededUser[];
  plan: EpisodePlan;
  /**
   * The group's facts before this episode. Balances net to zero by then, but
   * pair-level debts from earlier episodes need not, so the model has to hold
   * the history to stay comparable.
   */
  history: LedgerFact[];
}

/** Stable uuid per group and plan key, so a retried write is recognised. */
export function journeyUuid(groupId: string, key: string): string {
  const hex = createHash("sha256").update(`journey:${groupId}:${key}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The seed is the run id when GitHub provides one, so the journey a run took
 * is recoverable from the run page alone, and a random one locally.
 */
export function seedForRun(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT ?? 1);
  if (Number.isSafeInteger(runId) && runId > 0) {
    return ((runId % 2_000_000_000) + (Number.isSafeInteger(attempt) ? attempt : 1)) >>> 0 || 1;
  }
  return 1 + Math.floor(Math.random() * 2_000_000_000);
}

interface JourneyGroupRow {
  id: string;
  name: string;
  created_at: string;
}

interface BalanceCountRow {
  group_id: string;
}

interface JourneyMemberRow {
  user_id: string;
  status: string;
}

interface GroupCreatorRow {
  creator_id: string;
}

/**
 * Makes every bot of this episode an accepted member of the group.
 *
 * create_group accepts only the creator and leaves the rest invited, and the
 * pool outlives a run, so a later episode with a different first member reads
 * the group as an invited viewer. ledger_group_snapshot_json answers that
 * viewer with empty balances by design, which the model then reads as
 * divergence. Accepting is driven by the stored status, so this is safe to
 * repeat and repairs a group left half-joined by an earlier run.
 */
async function acceptJourneyMembers(
  troupe: Troupe,
  groupId: string,
  members: SeededUser[],
): Promise<void> {
  const { data: group, error: groupError } = await troupe.admin
    .from("groups")
    .select("creator_id")
    .eq("id", groupId)
    .maybeSingle<GroupCreatorRow>();
  if (groupError || !group) {
    throw new Error(`journey group creator lookup failed: ${groupError?.message ?? "missing"}`);
  }

  const { data: rows, error: rowsError } = await troupe.admin
    .from("group_members")
    .select("user_id,status")
    .eq("group_id", groupId)
    .returns<JourneyMemberRow[]>();
  if (rowsError) {
    throw new Error(`journey membership lookup failed: ${rowsError.message}`);
  }
  const status = new Map((rows ?? []).map((row) => [row.user_id, row.status]));

  for (const member of members) {
    if (!status.has(member.id)) {
      await troupe.seed.inviteMember(group.creator_id, groupId, member.id);
      status.set(member.id, "invited");
    }
    if (status.get(member.id) === "accepted") continue;
    const client = await troupe.seed.authenticateAs(member.id);
    const { error } = await client.rpc("accept_invitation", { p_group_id: groupId });
    if (error) {
      throw new Error(
        `journey accept_invitation failed for ${member.handle}: ${error.message}`,
      );
    }
    status.set(member.id, "accepted");
  }
}

/**
 * Picks the journey group to use: the emptiest of the pool, preferring one
 * with no outstanding balance, and creating a new one while the pool is
 * still short.
 */
export async function findOrCreateJourneyGroup(
  troupe: Troupe,
  members: SeededUser[],
): Promise<{ groupId: string; groupName: string }> {
  const { data, error } = await troupe.admin
    .from("groups")
    .select("id,name,created_at")
    .like("name", `${JOURNEY_GROUP_PREFIX} %`)
    .order("created_at", { ascending: true })
    .returns<JourneyGroupRow[]>();
  if (error) {
    throw new Error(`journey group lookup failed: ${error.message}`);
  }
  const groups = data ?? [];

  if (groups.length < JOURNEY_POOL_SIZE) {
    const name = `${JOURNEY_GROUP_PREFIX} ${groups.length + 1}`;
    const group = await troupe.seed.createGroup(
      members[0].id,
      members.slice(1).map((member) => member.id),
      name,
    );
    note(
      `New journey group "${name}" opened by ` +
        members.map((member) => firstName(troupe.bots, member.id)).join(", "),
    );
    await acceptJourneyMembers(troupe, group.id, members);
    return { groupId: group.id, groupName: name };
  }

  // group_balances only holds non-zero rows, so a group missing from this
  // read is fully settled and ready for a fresh episode.
  const { data: owing, error: owingError } = await troupe.admin
    .from("group_balances")
    .select("group_id")
    .in(
      "group_id",
      groups.map((group) => group.id),
    )
    .returns<BalanceCountRow[]>();
  if (owingError) {
    throw new Error(`journey balance lookup failed: ${owingError.message}`);
  }
  const unsettled = new Set((owing ?? []).map((row) => row.group_id));
  const settled = groups.find((group) => !unsettled.has(group.id));
  const chosen = settled ?? groups[0];
  await acceptJourneyMembers(troupe, chosen.id, members);
  return { groupId: chosen.id, groupName: chosen.name };
}

async function snapshotOf(troupe: Troupe, journey: Journey) {
  const client = await troupe.seed.authenticateAs(journey.members[0].id);
  const { data, error } = await client.rpc("get_group", { p_group_id: journey.groupId });
  if (error) {
    throw new Error(`journey get_group failed: ${error.message}`);
  }
  const decoded = decodeGroupSnapshot(data);
  if (!decoded.ok) {
    throw new Error(`journey snapshot rejected at ${decoded.issue.path.join(".") || "<root>"}`);
  }
  return decoded.value;
}

/**
 * Leaves the group owing nothing. A previous run that died mid-episode is the
 * only reason there is anything to clear, and it has to be cleared before a
 * planned journey can be trusted: the plan assumes it starts from zero.
 */
export async function clearOutstanding(troupe: Troupe, journey: Journey): Promise<number> {
  let cleared = 0;
  for (let round = 0; round < JOURNEY_MEMBER_COUNT * 4; round++) {
    const snapshot = await snapshotOf(troupe, journey);
    const transfers = transfersFromBalances(snapshot.balances);
    if (transfers.length === 0) break;
    const transfer = transfers[0];
    const payer = journey.members.find((member) => member.id === transfer.fromId);
    if (!payer) {
      throw new Error(`journey balance names ${transfer.fromId}, who is not on this journey`);
    }
    const client = await troupe.seed.authenticateAs(payer.id);
    const { error } = await client.rpc("record_settlement", {
      p_operation_id: journeyUuid(journey.groupId, `recover-${round}-${transfer.amountCents}`),
      p_group_id: journey.groupId,
      p_from_user_id: transfer.fromId,
      p_to_user_id: transfer.toId,
      p_amount_cents: transfer.amountCents,
      p_allow_overpay: false,
    });
    if (error) {
      throw new Error(`journey recovery settlement failed: ${error.message}`);
    }
    cleared += 1;
  }
  if (cleared > 0) {
    note(`Cleared ${cleared} leftover balance${cleared === 1 ? "" : "s"} before setting off`);
  }
  return cleared;
}

function describeAction(
  troupe: Troupe,
  journey: Journey,
  action: WalkAction,
): string | null {
  const who = (member: number) => firstName(troupe.bots, journey.members[member].id);
  switch (action.kind) {
    case "create":
      return `${who(action.actor)} paid ${formatBRL(action.plan.totalCents)} for "${action.plan.title}", split ${action.plan.participants.length} ways`;
    case "settle":
      return `${who(action.from)} settled ${formatBRL(action.amountCents)} with ${who(action.to)}`;
    case "void":
      return `${who(action.actor)} took back a payment that was already recorded`;
    case "delete":
      return `${who(action.actor)} deleted an expense the group had agreed on`;
    case "restore":
      return `${who(action.actor)} brought a deleted expense back`;
    case "edit":
      return null;
  }
}

/**
 * Takes the whole journey in one pass, checking production against the model
 * after every write. An episode is self-contained, so there is nothing to
 * resume: a run that dies leaves a balance the next run clears before setting
 * off.
 */
export async function runJourney(
  troupe: Troupe,
  journey: Journey,
  diaryNotes = 2,
): Promise<number> {
  const memberIds = journey.members.map((member) => member.id);
  const run = new WalkRun({
    groupId: journey.groupId,
    memberIds,
    clientFor: (member) => troupe.seed.authenticateAs(memberIds[member]),
    uuidFor: (key) => journeyUuid(journey.groupId, key),
    occurredOn: new Date().toISOString().slice(0, 10),
  });

  let notesLeft = diaryNotes;

  for (const [index, action] of journey.plan.actions.entries()) {
    await run.apply(action);

    const snapshot = await snapshotOf(troupe, journey);
    const mismatch = compareToModel(snapshot, [
      ...journey.history,
      ...factsAfter(journey.plan, index + 1, memberIds),
    ]);
    if (mismatch) {
      note(`Journey seed ${journey.plan.seed} diverged after ${action.kind} ${action.key}`);
      throw new Error(
        `journey seed ${journey.plan.seed} diverged in ${journey.groupName} after ` +
          `${action.kind} ${action.key}: ${mismatch}`,
      );
    }

    const line = notesLeft > 0 ? describeAction(troupe, journey, action) : null;
    if (line) {
      note(line);
      notesLeft -= 1;
    }
  }

  const snapshot = await snapshotOf(troupe, journey);
  if (snapshot.balances.length > 0) {
    throw new Error(
      `journey seed ${journey.plan.seed} ended owing ${JSON.stringify(snapshot.balances)}`,
    );
  }
  note(
    `Journey ${journey.plan.seed} done in "${journey.groupName}": ` +
      `${journey.plan.actions.length} moves, everyone back to zero`,
  );

  return journey.plan.actions.length;
}

/**
 * Trims the group back to the active-expense cap, deleting the oldest through
 * the same RPC a person would use, as the bot who created them.
 */
export async function pruneJourneyGroup(troupe: Troupe, groupId: string): Promise<number> {
  const { data, error } = await troupe.admin
    .from("expenses")
    .select("id,creator_id,created_at")
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .returns<{ id: string; creator_id: string; created_at: string }[]>();
  if (error) {
    throw new Error(`journey prune: list expenses failed: ${error.message}`);
  }

  const rows = data ?? [];
  let deleted = 0;
  while (rows.length - deleted > JOURNEY_ACTIVE_EXPENSE_CAP) {
    const oldest = rows[deleted];
    const client = await troupe.seed.authenticateAs(oldest.creator_id);
    const { error: deleteError } = await client.rpc("delete_expense", {
      p_expense_id: oldest.id,
    });
    if (deleteError) {
      throw new Error(`journey prune: delete_expense failed: ${deleteError.message}`);
    }
    deleted += 1;
  }
  return deleted;
}

/** Plans this run's journey and points it at a group from the pool. */
export async function startJourney(troupe: Troupe, seed: number): Promise<Journey> {
  const members = troupe.bots.slice(0, JOURNEY_MEMBER_COUNT);
  const { groupId, groupName } = await findOrCreateJourneyGroup(troupe, members);
  const journey: Journey = {
    groupId,
    groupName,
    members,
    plan: planEpisode({ seed, memberCount: JOURNEY_MEMBER_COUNT, steps: JOURNEY_STEPS }),
    history: [],
  };

  await pruneJourneyGroup(troupe, groupId);
  await clearOutstanding(troupe, journey);

  const snapshot = await snapshotOf(troupe, journey);
  if (snapshot.balances.length > 0) {
    throw new Error(`journey group ${groupName} still owes after recovery`);
  }

  // The plan assumes it starts from nothing owed, which now holds. Pair-level
  // history does not have to be clean, so it travels with the journey.
  journey.history = (await replayTrip(troupe, groupId)).facts;
  const drift = compareToModel(snapshot, journey.history);
  if (drift) {
    throw new Error(`journey group ${groupName} disagrees with the model before setting off: ${drift}`);
  }
  return journey;
}
