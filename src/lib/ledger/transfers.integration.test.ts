import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUsers,
  createGroup,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { transfersFromBalances } from "./transfers";
import type { BalanceRow, Transfer } from "@/types/ledger";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDeterministicUuid(rand: () => number): string {
  const hexChar = () => Math.floor(rand() * 16).toString(16);
  const segment = (len: number) => Array.from({ length: len }, hexChar).join("");
  return `${segment(8)}-${segment(4)}-4${segment(3)}-8${segment(3)}-${segment(12)}`;
}

interface ParticipantSlot {
  kind: "user" | "guest";
  participantId: string;
}

function generateParticipantsAndNets(
  rand: () => number,
  userPool: readonly TestUser[],
): BalanceRow[] {
  const k = 2 + Math.floor(rand() * 7);

  let nets: number[] = [];
  while (true) {
    nets = [];
    for (let i = 0; i < k - 1; i++) {
      let val = 0;
      while (val === 0) {
        val = Math.floor(rand() * 20001) - 10000;
      }
      nets.push(val);
    }
    const last = -nets.reduce((sum, n) => sum + n, 0);
    if (last !== 0 && last >= -50000 && last <= 50000) {
      nets.push(last);
      const hasDebtor = nets.some((n) => n < 0);
      const hasCreditor = nets.some((n) => n > 0);
      if (hasDebtor && hasCreditor) {
        break;
      }
    }
  }

  const maxGuests = Math.min(3, k - 1);
  const guestCount = Math.floor(rand() * (maxGuests + 1));
  const userCount = k - guestCount;

  const shuffledUsers = [...userPool];
  for (let i = shuffledUsers.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = shuffledUsers[i];
    shuffledUsers[i] = shuffledUsers[j];
    shuffledUsers[j] = temp;
  }

  const participants: ParticipantSlot[] = [];
  for (let i = 0; i < userCount; i++) {
    participants.push({ kind: "user", participantId: shuffledUsers[i].id });
  }
  for (let i = 0; i < guestCount; i++) {
    participants.push({ kind: "guest", participantId: generateDeterministicUuid(rand) });
  }

  for (let i = participants.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = participants[i];
    participants[i] = participants[j];
    participants[j] = temp;
  }

  return participants.map((p, i) => ({
    kind: p.kind,
    participantId: p.participantId,
    netCents: nets[i],
  }));
}

describe.skipIf(!isIntegrationTestReady)(
  "group_transfers SQL vs TypeScript parity (200 random ledgers)",
  () => {
    let users: TestUser[] = [];
    const createdGroupIds: string[] = [];

    beforeAll(async () => {
      users = await createTestUsers(8);
    });

    afterAll(async () => {
      if (createdGroupIds.length > 0) {
        await withPg(async (client) => {
          await client.query("DELETE FROM public.groups WHERE id = ANY($1::uuid[])", [
            createdGroupIds,
          ]);
        });
      }
    });

    async function runParityBatch(startSeed: number, endSeed: number): Promise<void> {
      await withPg(async (client) => {
        for (let seed = startSeed; seed <= endSeed; seed++) {
          const rand = mulberry32(seed);
          const { groupId } = await createGroup(users[0], `parity-${seed}`);
          createdGroupIds.push(groupId);

          const rows = generateParticipantsAndNets(rand, users);

          const params: unknown[] = [groupId];
          const placeholders = rows.map((row, i) => {
            const offset = 1 + i * 3;
            params.push(row.kind, row.participantId, row.netCents);
            return `($1, $${offset + 1}::public.participant_kind, $${offset + 2}::uuid, $${offset + 3}::bigint)`;
          });

          await client.query(
            `INSERT INTO public.group_balances (group_id, kind, participant_id, net_cents) VALUES ${placeholders.join(", ")}`,
            params,
          );

          const sqlResult = await client.query<{
            from_kind: "user" | "guest";
            from_id: string;
            to_id: string;
            amount_cents: string;
          }>("SELECT from_kind, from_id, to_id, amount_cents FROM public.group_transfers($1)", [
            groupId,
          ]);

          const sqlTransfers: Transfer[] = sqlResult.rows.map((r) => ({
            fromKind: r.from_kind,
            fromId: r.from_id,
            toId: r.to_id,
            amountCents: Number(r.amount_cents),
          }));

          const tsTransfers = transfersFromBalances(rows);
          expect(sqlTransfers).toEqual(tsTransfers);
        }
      });
    }

    it("matches SQL group_transfers for seeds 1..50", async () => {
      await runParityBatch(1, 50);
    });

    it("matches SQL group_transfers for seeds 51..100", async () => {
      await runParityBatch(51, 100);
    });

    it("matches SQL group_transfers for seeds 101..150", async () => {
      await runParityBatch(101, 150);
    });

    it("matches SQL group_transfers for seeds 151..200", async () => {
      await runParityBatch(151, 200);
    });
  },
);
