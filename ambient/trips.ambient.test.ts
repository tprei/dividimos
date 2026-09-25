import { beforeAll, describe, expect, it } from "vitest";
import {
  type LedgerFact,
  projectBalances,
  projectTransfers,
} from "../src/lib/ledger/model";
import type { ExpensePayload } from "../src/types/ledger";
import { ensureTroupe, type Troupe } from "./bots";
import { TRIPS } from "./trip-scripts";
import {
  factId,
  findOrStartTrip,
  pendingSteps,
  runPendingSteps,
  type Trip,
  type TripContext,
  type TripModelContext,
  verifyAgainstProduction,
} from "./trips";

const MAX_TRIP_FACTS = 12;

function simulate(trip: Trip): TripModelContext {
  const members = Array.from({ length: trip.memberCount }, (_, index) => ({
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
  }));
  const ctx: TripModelContext = {
    groupId: "sim",
    members,
    state: { facts: [], expenses: [], settlements: [] },
  };

  const rowsOf = (payload: ExpensePayload) =>
    payload.participants.map((participant, index) => ({
      participantId: participant.kind === "user" ? participant.userId : "guest",
      shareCents: payload.shares[index],
      paidCents: payload.payers
        .filter((payer) => payer.participantIndex === index)
        .reduce((sum, payer) => sum + payer.amountCents, 0),
    }));

  const rebuild = () => {
    ctx.state.facts = [
      ...ctx.state.expenses.map(
        (expense): LedgerFact => ({
          kind: "expense",
          expenseId: expense.expenseId,
          clientId: expense.clientId,
          status: expense.status,
          versionNo: expense.versionNo,
          rows: rowsOf(expense.payload),
        }),
      ),
      ...ctx.state.settlements.map(
        (settlement): LedgerFact => ({
          kind: "settlement",
          settlementId: settlement.settlementId,
          operationId: settlement.operationId,
          status: settlement.status,
          fromUserId: settlement.fromUserId,
          toUserId: settlement.toUserId,
          amountCents: settlement.amountCents,
        }),
      ),
    ];
  };

  const expenseOf = (key: string) => {
    const record = ctx.state.expenses.find(
      (expense) => expense.clientId === factId(ctx.groupId, key),
    );
    if (!record) throw new Error(`simulation has no expense for ${key}`);
    return record;
  };

  const settle = (key: string, from: number, to: number, amountCents: number) => {
    ctx.state.settlements.push({
      settlementId: key,
      operationId: factId(ctx.groupId, key),
      status: "confirmed",
      fromUserId: ctx.members[from].id,
      toUserId: ctx.members[to].id,
      amountCents,
    });
    rebuild();
  };

  for (const step of trip.steps) {
    switch (step.kind) {
      case "create": {
        const spec = step.spec(ctx);
        ctx.state.expenses.push({
          expenseId: step.key,
          clientId: factId(ctx.groupId, step.key),
          status: "active",
          versionNo: 1,
          occurredOn: "2026-01-01",
          title: spec.title,
          expenseType: "single_amount",
          totalCents: spec.totalCents,
          serviceFeeBps: spec.serviceFeeBps ?? 0,
          fixedFeeCents: spec.fixedFeeCents ?? 0,
          payload: {
            items: [],
            participants: spec.participants.map((member) => ({
              kind: "user",
              userId: ctx.members[member].id,
            })),
            shares: spec.shares,
            payers: spec.payers,
            itemAssignments: null,
          },
        });
        rebuild();
        break;
      }
      case "edit": {
        const record = expenseOf(step.targetKey);
        record.payload = step.mutate(record.payload);
        record.versionNo += 1;
        rebuild();
        break;
      }
      case "delete": {
        expenseOf(step.targetKey).status = "deleted";
        rebuild();
        break;
      }
      case "restore": {
        expenseOf(step.targetKey).status = "active";
        rebuild();
        break;
      }
      case "settle": {
        const amountCents = step.amount(ctx);
        if (amountCents < 1) break;
        settle(step.key, step.from, step.to, amountCents);
        break;
      }
      case "void": {
        const target = ctx.state.settlements.find(
          (settlement) => settlement.operationId === factId(ctx.groupId, step.targetKey),
        );
        // Matches the engine: nothing was paid, so nothing is taken back.
        if (!target) break;
        target.status = "voided";
        rebuild();
        break;
      }
      case "settleAll": {
        for (let round = 0; round < MAX_TRIP_FACTS; round += 1) {
          const transfers = projectTransfers(ctx.state.facts);
          if (transfers.length === 0) break;
          const transfer = transfers[0];
          const from = ctx.members.findIndex((member) => member.id === transfer.fromId);
          const to = ctx.members.findIndex((member) => member.id === transfer.toId);
          settle(`close-${round}`, from, to, transfer.amountCents);
        }
        break;
      }
      case "probe":
        break;
    }
  }

  return ctx;
}

describe("trip scripts", () => {
  for (const trip of TRIPS) {
    it(`${trip.name} settles every balance to zero`, () => {
      const facts = simulate(trip).state.facts;

      expect(projectBalances(facts)).toEqual([]);
      expect(facts.length).toBeLessThanOrEqual(MAX_TRIP_FACTS);
      expect(facts.length).toBeGreaterThan(0);
    });

    // Without this, a finished trip looks unfinished forever: a restore
    // clears the deleted marker, and a settlement that had nothing to pay
    // leaves no fact. Either one would keep the arc replaying every run and
    // never let the next day's trip start.
    it(`${trip.name} reports nothing left to do once it is over`, () => {
      expect(pendingSteps(simulate(trip), trip)).toEqual([]);
    });
  }

  // An overpay earlier in an arc can leave a later settlement with nothing
  // to pay. That has to count as done, or the trip never ends.
  it("treats a settlement with nothing to pay as done", () => {
    const trip: Trip = {
      name: "Café rápido",
      memberCount: 2,
      steps: [
        {
          key: "c1",
          kind: "create",
          actor: 0,
          spec: () => ({
            title: "Café",
            totalCents: 500,
            participants: [0, 1],
            shares: [250, 250],
            payers: [{ participantIndex: 0, amountCents: 500 }],
          }),
        },
        { key: "s1", kind: "settle", actor: 1, from: 1, to: 0, amount: () => 0 },
        { key: "close", kind: "settleAll" },
      ],
    };

    const ctx = simulate(trip);

    expect(pendingSteps(ctx, trip)).toEqual([]);
    expect(projectBalances(ctx.state.facts)).toEqual([]);
  });
});

describe("bot trips", () => {
  let troupe: Troupe;
  let ctx: TripContext;
  let trip: Trip;

  beforeAll(async () => {
    troupe = await ensureTroupe();
    ctx = await findOrStartTrip(troupe, TRIPS, new Date().toISOString().slice(0, 10));
    trip = TRIPS[ctx.tripIndex % TRIPS.length];
  });

  it("matches the model on everything the trip has done so far", async () => {
    await verifyAgainstProduction(ctx, "replay");
  });

  it("advances the trip", async () => {
    await runPendingSteps(ctx, trip, 4);
  });

  it("keeps advancing the trip", async () => {
    await runPendingSteps(ctx, trip, 4);
  });

  it("closes the trip when the script runs out", async () => {
    await runPendingSteps(ctx, trip, 6);

    if (pendingSteps(ctx, trip).length === 0) {
      expect(projectBalances(ctx.state.facts)).toEqual([]);
    }
  });
});
