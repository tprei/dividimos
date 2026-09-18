import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeGroupSnapshot } from "@/lib/ledger/decode";
import { projectBalances } from "@/lib/ledger/model";
import { factsAfter, planEpisode } from "@/lib/ledger/walk";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { propertyConfig } from "@/test/property";
import { compareToModel, WalkRun } from "@/test/walk-driver";

const MEMBER_COUNT = 4;
const STEPS = 10;

/**
 * The journeys the bots take in production are planned by the same generator
 * this test drives against a local database. A red ambient run reports its
 * seed; putting that seed here replays the exact journey with a debugger
 * attached and no production writes.
 */
describe.skipIf(!isIntegrationTestReady)("planned journeys against the database", () => {
  let users: TestUser[];

  beforeAll(async () => {
    users = await createTestUsers(MEMBER_COUNT);
  });

  async function readSnapshot(groupId: string) {
    const client = authenticateAs(users[0]);
    const { data, error } = await client.rpc("get_group", { p_group_id: groupId });
    if (error) {
      throw new Error(`get_group failed: ${error.message}`);
    }
    const decoded = decodeGroupSnapshot(data);
    if (!decoded.ok) {
      throw new Error(`get_group payload rejected at ${decoded.issue.path.join(".")}`);
    }
    return decoded.value;
  }

  async function runSeed(seed: number): Promise<void> {
    const plan = planEpisode({ seed, memberCount: MEMBER_COUNT, steps: STEPS });
    const memberIds = users.map((user) => user.id);
    const groupId = await createGroupWithMembers(users[0], users.slice(1), `Journey ${seed}`);

    const run = new WalkRun({
      groupId,
      memberIds,
      clientFor: (member) => authenticateAs(users[member]),
      uuidFor: () => crypto.randomUUID(),
      occurredOn: new Date().toISOString().slice(0, 10),
    });

    for (const [index, action] of plan.actions.entries()) {
      await run.apply(action);
      const snapshot = await readSnapshot(groupId);
      const mismatch = compareToModel(snapshot, factsAfter(plan, index + 1, memberIds));
      expect(
        mismatch,
        `seed ${seed} diverged after ${action.kind} ${action.key}: ${mismatch}`,
      ).toBeNull();
    }

    // A journey that ends owing nothing is what lets a group be reused.
    const finalSnapshot = await readSnapshot(groupId);
    expect(finalSnapshot.balances).toEqual([]);
    expect(projectBalances(factsAfter(plan, plan.actions.length, memberIds))).toEqual([]);
  }

  it("agrees with the model after every action of a planned journey", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), async (seed) => {
        await runSeed(seed);
      }),
      propertyConfig(12),
    );
  });
});
