import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import {
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
  type ExpenseCents,
  type ValidationResult,
} from "@/lib/expense-money";
import { createTestUsers, withPg, type TestUser } from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { propertyConfig } from "@/test/property";
import type { ExpensePayload } from "@/types/ledger";

const MAX_TOTAL_CENTS = 99_999_999;

function unwrap(result: ValidationResult<readonly ExpenseCents[]>): number[] {
  if (!result.ok) {
    throw new Error(`allocation failed: ${JSON.stringify(result.issue)}`);
  }
  return result.value.map((value) => value as number);
}

function unwrapCents(result: ValidationResult<ExpenseCents>): number {
  if (!result.ok) {
    throw new Error(`fee computation failed: ${JSON.stringify(result.issue)}`);
  }
  return result.value as number;
}

async function validate(
  client: Client,
  payload: ExpensePayload,
  expenseType: "itemized" | "single_amount",
  totalCents: number,
  feeBps: number,
  fixedFeeCents: number,
): Promise<ExpensePayload> {
  const result = await client.query<{ result: ExpensePayload }>(
    "select public.validate_expense_payload($1::jsonb, $2::public.expense_type, " +
      "$3::integer, $4::integer, $5::integer) as result",
    [JSON.stringify(payload), expenseType, totalCents, feeBps, fixedFeeCents],
  );
  return result.rows[0].result;
}

async function validationError(
  client: Client,
  payloadJson: string,
  expenseType: "itemized" | "single_amount",
  totalCents: number,
  feeBps: number,
  fixedFeeCents: number,
): Promise<string> {
  try {
    await client.query(
      "select public.validate_expense_payload($1::jsonb, $2::public.expense_type, " +
        "$3::integer, $4::integer, $5::integer)",
      [payloadJson, expenseType, totalCents, feeBps, fixedFeeCents],
    );
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected validate_expense_payload to reject");
}

interface ItemizedCase {
  payload: ExpensePayload;
  totalCents: number;
  feeBps: number;
  fixedFeeCents: number;
}

/**
 * Builds an itemized bill the way the bill store does: per-item assignments
 * split evenly across a subset, the service fee spread by item subtotal, and
 * the fixed fee spread evenly.
 */
function itemizedCase(userIds: readonly string[]): fc.Arbitrary<ItemizedCase> {
  return fc
    .record({
      participantCount: fc.integer({ min: 2, max: Math.min(6, userIds.length) }),
      items: fc.array(
        fc.record({
          quantityMilliunits: fc.integer({ min: 1, max: 10_000 }),
          unitPriceCents: fc.integer({ min: 0, max: 200_000 }),
          assignMask: fc.integer({ min: 1, max: 63 }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      feeBps: fc.constantFrom(0, 1, 57, 1000, 9999, 10_000),
      fixedFeeCents: fc.constantFrom(0, 1, 7, 999),
      payerCount: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ participantCount, items, feeBps, fixedFeeCents, payerCount }): ItemizedCase => {
      const participants = userIds.slice(0, participantCount);
      const lines = items.map((item) => ({
        description: "Item",
        quantityMilliunits: item.quantityMilliunits,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: Math.floor((item.quantityMilliunits * item.unitPriceCents + 500) / 1000),
        assignedTo: participants
          .map((_, index) => index)
          .filter((index) => ((item.assignMask >> index) & 1) === 1),
      }));

      const itemAssignments = lines.flatMap((line, itemIndex) => {
        const targets = line.assignedTo.length > 0 ? line.assignedTo : [0];
        const split = unwrap(allocateEvenly(line.totalPriceCents, targets.length));
        return targets.map((participantIndex, slot) => ({
          itemIndex,
          participantIndex,
          amountCents: split[slot],
        }));
      });

      const subtotals = participants.map((_, index) =>
        itemAssignments
          .filter((assignment) => assignment.participantIndex === index)
          .reduce((sum, assignment) => sum + assignment.amountCents, 0),
      );
      const itemsSubtotal = subtotals.reduce((sum, value) => sum + value, 0);
      const serviceFeeCents = unwrapCents(computeServiceFeeCents(itemsSubtotal, feeBps));
      const feeShares =
        itemsSubtotal === 0
          ? participants.map(() => 0)
          : unwrap(allocateByWeights(serviceFeeCents, subtotals));
      const fixedShares = unwrap(allocateEvenly(fixedFeeCents, participants.length));

      const totalCents = itemsSubtotal + serviceFeeCents + fixedFeeCents;
      const payers = Math.min(payerCount, participants.length);
      const paid = unwrap(allocateEvenly(totalCents, payers));

      return {
        totalCents,
        feeBps,
        fixedFeeCents,
        payload: {
          items: lines.map((line) => ({
            description: line.description,
            quantityMilliunits: line.quantityMilliunits,
            unitPriceCents: line.unitPriceCents,
            totalPriceCents: line.totalPriceCents,
          })),
          participants: participants.map((userId) => ({ kind: "user", userId })),
          shares: participants.map(
            (_, index) => subtotals[index] + feeShares[index] + fixedShares[index],
          ),
          payers: paid.map((amountCents, participantIndex) => ({
            participantIndex,
            amountCents,
          })),
          itemAssignments,
        },
      };
    })
    .filter(
      (value) =>
        value.totalCents >= 1 &&
        value.totalCents <= MAX_TOTAL_CENTS &&
        value.payload.payers.every((payer) => payer.amountCents >= 1),
    );
}

describe.skipIf(!isIntegrationTestReady)("validate_expense_payload TypeScript parity", () => {
  let users: TestUser[] = [];

  beforeAll(async () => {
    users = await createTestUsers(6);
  });

  it("accepts exactly the itemized shares the TypeScript allocators produce", async () => {
    await withPg(async (client) => {
      await fc.assert(
        fc.asyncProperty(
          itemizedCase(users.map((user) => user.id)),
          async ({ payload, totalCents, feeBps, fixedFeeCents }) => {
            // validate_expense_payload echoes the shares it was given, so the
            // parity lives in whether it accepts them: its own fee split and
            // fixed-fee split have to land on the same vector.
            await expect(
              validate(client, payload, "itemized", totalCents, feeBps, fixedFeeCents),
            ).resolves.toBeTruthy();
          },
        ),
        propertyConfig(150),
      );
    });
  });

  it("rejects a share decomposition that no longer matches the item assignments", async () => {
    await withPg(async (client) => {
      await fc.assert(
        fc.asyncProperty(
          itemizedCase(users.map((user) => user.id)),
          fc.nat({ max: 100 }),
          async ({ payload, totalCents, feeBps, fixedFeeCents }, pick) => {
            const count = payload.shares.length;
            const donor = pick % count;
            const receiver = (donor + 1) % count;
            fc.pre(payload.shares[donor] >= 1);

            const shares = [...payload.shares];
            shares[donor] -= 1;
            shares[receiver] += 1;

            const message = await validationError(
              client,
              JSON.stringify({ ...payload, shares }),
              "itemized",
              totalCents,
              feeBps,
              fixedFeeCents,
            );
            expect(message).toBe("item_assignment_share_mismatch");
          },
        ),
        propertyConfig(150),
      );
    });
  });

  it("rejects a total that no longer equals items plus fees", async () => {
    await withPg(async (client) => {
      await fc.assert(
        fc.asyncProperty(
          itemizedCase(users.map((user) => user.id)),
          async ({ payload, totalCents, feeBps, fixedFeeCents }) => {
            const message = await validationError(
              client,
              JSON.stringify(payload),
              "itemized",
              totalCents,
              feeBps,
              fixedFeeCents + 1,
            );
            expect(message).toBe("itemized_total_mismatch");
          },
        ),
        propertyConfig(150),
      );
    });
  });

  it("accepts an evenly split single amount and rejects a short share", async () => {
    await withPg(async (client) => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 6 }),
          fc.integer({ min: 8, max: MAX_TOTAL_CENTS }),
          async (participantCount, totalCents) => {
            const participants = users.slice(0, participantCount);
            const shares = unwrap(allocateEvenly(totalCents, participantCount));
            const payload: ExpensePayload = {
              items: [],
              participants: participants.map((user) => ({ kind: "user", userId: user.id })),
              shares,
              payers: [{ participantIndex: 0, amountCents: totalCents }],
              itemAssignments: null,
            };

            await expect(
              validate(client, payload, "single_amount", totalCents, 0, 0),
            ).resolves.toBeTruthy();

            const short = [...shares];
            short[0] -= 1;
            const message = await validationError(
              client,
              JSON.stringify({ ...payload, shares: short }),
              "single_amount",
              totalCents,
              0,
              0,
            );
            expect(message).toBe("share_total_mismatch");
          },
        ),
        propertyConfig(150),
      );
    });
  });

  it("rejects non-integer item numbers on every field alike", async () => {
    const fields = ["quantityMilliunits", "unitPriceCents", "totalPriceCents"] as const;
    await withPg(async (client) => {
      for (const field of fields) {
        const item: Record<string, unknown> = {
          description: "Item",
          quantityMilliunits: 1000,
          unitPriceCents: 100,
          totalPriceCents: 100,
        };
        const json = JSON.stringify({
          items: [item],
          participants: [{ kind: "user", userId: users[0].id }],
          shares: [100],
          payers: [{ participantIndex: 0, amountCents: 100 }],
          itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: 100 }],
        }).replace(`"${field}":${item[field]}`, `"${field}":${item[field]}.0`);

        const message = await validationError(client, json, "itemized", 100, 0, 0);
        expect(message).toBe("invalid_payload");
      }
    });
  });
});
