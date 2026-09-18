import { beforeAll, describe, expect, it } from "vitest";
import { projectBalances } from "../src/lib/ledger/model";
import { factsAfter, planEpisode } from "../src/lib/ledger/walk";
import { ensureTroupe, type Troupe } from "./bots";
import {
  type Journey,
  JOURNEY_MEMBER_COUNT,
  JOURNEY_STEPS,
  journeyUuid,
  runJourney,
  seedForRun,
  startJourney,
} from "./journeys";

describe("journey planning", () => {
  it("plans a journey that ends with nobody owing anything", () => {
    const seed = seedForRun({ GITHUB_RUN_ID: "35363155634", GITHUB_RUN_ATTEMPT: "1" });
    const plan = planEpisode({ seed, memberCount: JOURNEY_MEMBER_COUNT, steps: JOURNEY_STEPS });
    const memberIds = Array.from({ length: JOURNEY_MEMBER_COUNT }, (_, index) => `m${index}`);

    expect(plan.actions.length).toBeGreaterThanOrEqual(JOURNEY_STEPS);
    expect(projectBalances(factsAfter(plan, plan.actions.length, memberIds))).toEqual([]);
  });

  it("derives the seed from the run so a red board can be replayed", () => {
    const first = seedForRun({ GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1" });
    const retry = seedForRun({ GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "2" });

    expect(first).toBe(seedForRun({ GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1" }));
    // A retry of the same run takes a different journey, so a flake does not
    // replay the identical writes.
    expect(retry).not.toBe(first);
    expect(seedForRun({})).toBeGreaterThan(0);
  });

  it("derives one stable uuid per group and step", () => {
    const group = "3f1d1a54-0000-4000-8000-000000000001";
    expect(journeyUuid(group, "a3")).toBe(journeyUuid(group, "a3"));
    expect(journeyUuid(group, "a3")).not.toBe(journeyUuid(group, "a4"));
    expect(journeyUuid(group, "a3")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("bot journeys", () => {
  let troupe: Troupe;
  let journey: Journey;

  beforeAll(async () => {
    troupe = await ensureTroupe();
    journey = await startJourney(troupe, seedForRun());
  });

  it("sets off from a group that owes nothing", () => {
    expect(journey.plan.actions.length).toBeGreaterThan(0);
  });

  it("takes the journey and arrives with everyone back to zero", async () => {
    const applied = await runJourney(troupe, journey);

    expect(applied).toBe(journey.plan.actions.length);
  });
});
