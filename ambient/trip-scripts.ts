import { allocateByWeights, allocateEvenly } from "../src/lib/expense-money";
import {
  debt,
  expenseFor,
  factId,
  owed,
  type Trip,
  type TripContext,
} from "./trips";

/**
 * The trips themselves. Each one is a fixed arc: a few expenses with uneven
 * shares and more than one payer, an edit, a delete, a void, a probe that
 * must be refused, and a close that settles every balance back to zero.
 */

function weighted(totalCents: number, weights: number[]): number[] {
  const allocated = allocateByWeights(totalCents, weights);
  if (!allocated.ok) {
    throw new Error(`trip share allocation failed: ${allocated.issue.code}`);
  }
  return allocated.value.map((cents) => cents as number);
}

function evenly(totalCents: number, count: number): number[] {
  const allocated = allocateEvenly(totalCents, count);
  if (!allocated.ok) {
    throw new Error(`trip even split failed: ${allocated.issue.code}`);
  }
  return allocated.value.map((cents) => cents as number);
}

async function expectSlip(
  ctx: TripContext,
  actor: number,
  rpcName: string,
  args: Record<string, unknown>,
  slip: string,
): Promise<void> {
  const client = await ctx.troupe.seed.authenticateAs(ctx.members[actor].id);
  const { error } = await client.rpc(rpcName, args);
  if (error?.message !== slip) {
    throw new Error(`trip probe expected ${slip} from ${rpcName}, got ${error?.message ?? "success"}`);
  }
}

export const TRIPS: Trip[] = [
  {
    name: "Churrasco de sábado",
    memberCount: 4,
    steps: [
      {
        key: "c1",
        kind: "create",
        actor: 0,
        spec: () => {
          const totalCents = 18_740;
          // Ana fronted most of it and Bruno chipped in less than his share,
          // so the arc starts with a real debt between them.
          const anaPaid = 15_000;
          return {
            title: "Churrasco de sábado",
            totalCents,
            participants: [0, 1, 2, 3],
            shares: weighted(totalCents, [3, 2, 2, 1]),
            payers: [
              { participantIndex: 0, amountCents: anaPaid },
              { participantIndex: 1, amountCents: totalCents - anaPaid },
            ],
            serviceFeeBps: 1_000,
          };
        },
      },
      {
        key: "c2",
        kind: "edit",
        actor: 0,
        targetKey: "c1",
        title: "Churrasco de sábado (ajustado)",
        mutate: (payload) => {
          const shares = [...payload.shares];
          shares[1] -= 200;
          shares[2] += 200;
          return { ...payload, shares };
        },
      },
      {
        key: "c3",
        kind: "create",
        actor: 2,
        spec: () => ({
          title: "Gelo e carvão",
          totalCents: 6_400,
          participants: [0, 1, 2, 3],
          shares: evenly(6_400, 4),
          payers: [{ participantIndex: 2, amountCents: 6_400 }],
        }),
      },
      {
        key: "p1",
        kind: "probe",
        run: (ctx) =>
          expectSlip(
            ctx,
            1,
            "record_settlement",
            {
              p_operation_id: factId(ctx.groupId, "p1"),
              p_group_id: ctx.groupId,
              p_from_user_id: ctx.members[1].id,
              p_to_user_id: ctx.members[0].id,
              p_amount_cents: debt(ctx, 1) + 1,
              p_allow_overpay: false,
            },
            "amount_exceeds_debt",
          ),
      },
      {
        key: "s1",
        kind: "settle",
        actor: 1,
        from: 1,
        to: 0,
        amount: (ctx) => Math.min(Math.floor((debt(ctx, 1) * 4) / 10), owed(ctx, 0)),
      },
      { key: "v1", kind: "void", actor: 1, targetKey: "s1" },
      {
        key: "s2",
        kind: "settle",
        actor: 1,
        from: 1,
        to: 0,
        amount: (ctx) => Math.min(debt(ctx, 1), owed(ctx, 0)),
      },
      {
        key: "c4",
        kind: "create",
        actor: 3,
        spec: () => ({
          title: "Pão de alho do Diego",
          totalCents: 1_500,
          participants: [3, 0],
          shares: evenly(1_500, 2),
          payers: [{ participantIndex: 0, amountCents: 1_500 }],
        }),
      },
      { key: "d1", kind: "delete", actor: 3, targetKey: "c4" },
      { key: "close", kind: "settleAll" },
    ],
  },
  {
    name: "Praia com a galera",
    memberCount: 5,
    steps: [
      {
        key: "c1",
        kind: "create",
        actor: 1,
        spec: () => ({
          title: "Aluguel da casa na praia",
          totalCents: 27_000,
          participants: [0, 1, 2, 3, 4],
          shares: weighted(27_000, [2, 2, 1, 1, 1]),
          payers: [
            { participantIndex: 1, amountCents: 20_000 },
            { participantIndex: 4, amountCents: 7_000 },
          ],
        }),
      },
      {
        key: "c2",
        kind: "create",
        actor: 4,
        spec: () => ({
          title: "Feira do fim de semana",
          totalCents: 9_990,
          participants: [4, 2, 3],
          shares: evenly(9_990, 3),
          payers: [{ participantIndex: 0, amountCents: 9_990 }],
        }),
      },
      { key: "d1", kind: "delete", actor: 4, targetKey: "c2" },
      { key: "r1", kind: "restore", actor: 4, targetKey: "c2" },
      {
        key: "p1",
        kind: "probe",
        run: (ctx) =>
          expectSlip(
            ctx,
            0,
            "record_settlement",
            {
              p_operation_id: factId(ctx.groupId, "p1"),
              p_group_id: ctx.groupId,
              p_from_user_id: ctx.members[2].id,
              p_to_user_id: ctx.members[1].id,
              p_amount_cents: 100,
              p_allow_overpay: false,
            },
            "not_party",
          ),
      },
      {
        key: "s1",
        kind: "settle",
        actor: 2,
        from: 2,
        to: 1,
        amount: (ctx) => Math.min(debt(ctx, 2), owed(ctx, 1)),
      },
      {
        key: "s2",
        kind: "settle",
        actor: 3,
        from: 3,
        to: 4,
        allowOverpay: true,
        amount: (ctx) => debt(ctx, 3) + 500,
      },
      { key: "close", kind: "settleAll" },
    ],
  },
  {
    name: "Rachadinha do rolê",
    memberCount: 3,
    steps: [
      {
        key: "c1",
        kind: "create",
        actor: 0,
        spec: () => ({
          title: "Bar do rolê",
          totalCents: 4_321,
          participants: [0, 1, 2],
          shares: [2_000, 1_321, 1_000],
          payers: [{ participantIndex: 0, amountCents: 4_321 }],
        }),
      },
      {
        key: "c2",
        kind: "create",
        actor: 1,
        spec: () => ({
          title: "Uber da volta",
          totalCents: 7_777,
          participants: [0, 1, 2],
          shares: evenly(7_777, 3),
          payers: [
            { participantIndex: 1, amountCents: 5_000 },
            { participantIndex: 2, amountCents: 2_777 },
          ],
        }),
      },
      {
        key: "c3",
        kind: "edit",
        actor: 1,
        targetKey: "c2",
        title: "Uber da volta (com a taxa)",
        mutate: (payload) => payload,
      },
      {
        key: "p1",
        kind: "probe",
        run: (ctx) =>
          expectSlip(
            ctx,
            0,
            "edit_expense",
            {
              p_expense_id: expenseFor(ctx, "c1").expenseId,
              p_expected_version_no: 0,
              p_occurred_on: expenseFor(ctx, "c1").occurredOn,
              p_title: expenseFor(ctx, "c1").title,
              p_merchant_name: "",
              p_expense_type: expenseFor(ctx, "c1").expenseType,
              p_total_cents: expenseFor(ctx, "c1").totalCents,
              p_service_fee_bps: expenseFor(ctx, "c1").serviceFeeBps,
              p_fixed_fee_cents: expenseFor(ctx, "c1").fixedFeeCents,
              p_payload: expenseFor(ctx, "c1").payload,
            },
            "stale_version",
          ),
      },
      {
        key: "s1",
        kind: "settle",
        actor: 2,
        from: 2,
        to: 0,
        amount: (ctx) => Math.min(Math.floor(debt(ctx, 2) / 2), owed(ctx, 0)),
      },
      {
        key: "s2",
        kind: "settle",
        actor: 2,
        from: 2,
        to: 0,
        amount: (ctx) => Math.min(debt(ctx, 2), owed(ctx, 0)),
      },
      { key: "close", kind: "settleAll" },
    ],
  },
];
