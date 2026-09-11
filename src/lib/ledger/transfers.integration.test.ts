import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGroup, createTestUsers, withPg, type TestUser } from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { propertyConfig } from "@/test/property";
import type { BalanceRow, Transfer } from "@/types/ledger";
import { transfersFromBalances } from "./transfers";

const MAX_MAGNITUDE = 500_000_000;

function zeroSumLedger(userIds: readonly string[]): fc.Arbitrary<BalanceRow[]> {
  return fc
    .array(
      fc.record({
        guest: fc.boolean(),
        guestId: fc.uuid(),
        userPick: fc.nat({ max: Math.max(0, userIds.length - 1) }),
        netCents: fc.integer({ min: -MAX_MAGNITUDE, max: MAX_MAGNITUDE }),
      }),
      { minLength: 2, maxLength: 9 },
    )
    .map((rows): BalanceRow[] => {
      const seen = new Set<string>();
      const slots = rows.flatMap((row) => {
        const kind = row.guest ? ("guest" as const) : ("user" as const);
        const participantId = row.guest ? row.guestId : userIds[row.userPick];
        const key = `${kind}:${participantId}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ kind, participantId, netCents: row.netCents }];
      });
      const head = slots.slice(0, -1);
      const closing = 0 - head.reduce((sum, slot) => sum + slot.netCents, 0);
      return [...head, { ...slots[slots.length - 1], netCents: closing }];
    })
    .filter(
      (rows) =>
        rows.length >= 2 && Math.abs(rows[rows.length - 1].netCents) <= MAX_MAGNITUDE,
    );
}

describe.skipIf(!isIntegrationTestReady)("group_transfers SQL vs TypeScript parity", () => {
  let users: TestUser[] = [];
  let groupId = "";

  beforeAll(async () => {
    users = await createTestUsers(8);
    groupId = (await createGroup(users[0], "parity")).groupId;
  });

  afterAll(async () => {
    if (!groupId) return;
    await withPg((client) =>
      client.query("DELETE FROM public.groups WHERE id = $1", [groupId]),
    );
  });

  it("minimizes the same transfers as transfersFromBalances", async () => {
    await withPg(async (client) => {
      await fc.assert(
        fc.asyncProperty(
          zeroSumLedger(users.map((user) => user.id)),
          async (balances) => {
            await client.query("DELETE FROM public.group_balances WHERE group_id = $1", [
              groupId,
            ]);

            const params: unknown[] = [groupId];
            const placeholders = balances.map((row, index) => {
              const offset = 1 + index * 3;
              params.push(row.kind, row.participantId, row.netCents);
              return `($1, $${offset + 1}::public.participant_kind, $${offset + 2}::uuid, $${offset + 3}::bigint)`;
            });
            await client.query(
              "INSERT INTO public.group_balances (group_id, kind, participant_id, net_cents) " +
                `VALUES ${placeholders.join(", ")}`,
              params,
            );

            const result = await client.query<{
              from_kind: BalanceRow["kind"];
              from_id: string;
              to_id: string;
              amount_cents: string;
            }>(
              "SELECT from_kind, from_id, to_id, amount_cents FROM public.group_transfers($1)",
              [groupId],
            );
            const sqlTransfers: Transfer[] = result.rows.map((row) => ({
              fromKind: row.from_kind,
              fromId: row.from_id,
              toId: row.to_id,
              amountCents: Number(row.amount_cents),
            }));

            expect(sqlTransfers).toEqual(transfersFromBalances(balances));
          },
        ),
        propertyConfig(200),
      );
    });
  });
});
