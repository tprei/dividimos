import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyExpenseDelta } from "@/lib/ledger/apply";
import { LedgerError } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import { propertyConfig } from "@/test/property";
import type {
  BalanceRow,
  ExpenseDetail,
  ExpenseHeader,
  ExpensePayload,
  ExpenseSummary,
  GroupSnapshot,
  Me,
  UserProfile,
} from "@/types/ledger";

import { rpc } from "./client";
import { deleteExpense, editExpense } from "./mutations";

vi.mock("@/lib/sync/client", () => ({
  rpc: vi.fn(),
  rpcVoid: vi.fn(),
  getSupabase: vi.fn(),
  getAuthGeneration: vi.fn(() => 0),
}));
// Fresh ids per run: refreshGroup's in-flight registry is module state in
// refresh.ts, and a run that aborts on a failing expectation would otherwise
// leave an entry bound to a dead scheduler that later runs wait on forever.
let runSeq = 0;
let GROUP_ID = "group-race-0";
let EXPENSE_ID = "expense-race-0";

const ME: Me = {
  id: "user-me",
  handle: "me_user",
  name: "Eu Mesmo",
  avatarUrl: null,
  email: "me@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: { expenses: true, settlements: true, nudges: true },
};

const OTHER: UserProfile = {
  id: "user-other",
  handle: "amigo",
  name: "Amigo",
  avatarUrl: null,
};

function payloadFor(totalCents: number): ExpensePayload {
  const half = Math.floor(totalCents / 2);
  return {
    items: [],
    participants: [
      { kind: "user", userId: ME.id },
      { kind: "user", userId: OTHER.id },
    ],
    shares: [totalCents - half, half],
    payers: [{ participantIndex: 0, amountCents: totalCents }],
    itemAssignments: null,
  };
}

function headerFor(totalCents: number): ExpenseHeader {
  return {
    occurredOn: "2026-01-01",
    title: `Corrida ${totalCents}`,
    merchantName: null,
    expenseType: "single_amount",
    totalCents,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
  };
}

interface ServerState {
  versionNo: number;
  ledgerVersion: number;
  status: "active" | "deleted";
  payload: ExpensePayload;
}

function serverBalances(state: ServerState): BalanceRow[] {
  if (state.status === "deleted") return [];
  return applyExpenseDelta([], state.payload, 1);
}

function snapshotOf(state: ServerState): GroupSnapshot {
  return {
    group: {
      id: GROUP_ID,
      kind: "group",
      name: "Viagem",
      creatorId: ME.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: state.ledgerVersion,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: [
      {
        groupId: GROUP_ID,
        userId: ME.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: "2026-01-01T00:00:00.000Z",
        user: ME,
      },
      {
        groupId: GROUP_ID,
        userId: OTHER.id,
        status: "accepted",
        invitedBy: ME.id,
        acceptedAt: "2026-01-01T00:00:00.000Z",
        user: OTHER,
      },
    ],
    balances: serverBalances(state),
    guests: [],
    settlements: [],
    recentExpenses: [summaryOf(state)],
    expenseCount: state.status === "active" ? 1 : 0,
    lastEventId: 10 + state.ledgerVersion,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    pairwiseEdges: [],
  };
}

function summaryOf(state: ServerState): ExpenseSummary {
  return {
    id: EXPENSE_ID,
    groupId: GROUP_ID,
    creatorId: ME.id,
    status: state.status,
    occurredOn: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    versionNo: state.versionNo,
    title: "Corrida",
    merchantName: null,
    expenseType: "single_amount",
    totalCents: state.payload.shares.reduce((sum, share) => sum + share, 0),
    myShareCents: state.payload.shares[0],
    myPaidCents: state.payload.payers[0].amountCents,
    participantCount: state.payload.participants.length,
  };
}

function detailOf(state: ServerState): ExpenseDetail {
  const totalCents = state.payload.shares.reduce((sum, share) => sum + share, 0);
  return {
    expense: {
      id: EXPENSE_ID,
      groupId: GROUP_ID,
      creatorId: ME.id,
      status: state.status,
      currentVersionNo: state.versionNo,
      occurredOn: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: state.status === "deleted" ? "2026-01-02T00:00:00.000Z" : null,
      deletedBy: state.status === "deleted" ? ME.id : null,
    },
    current: {
      ...headerFor(totalCents),
      expenseId: EXPENSE_ID,
      versionNo: state.versionNo,
      authorId: ME.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: state.payload,
      changeSummary: null,
    },
    versions: [],
    participants: [],
    group: { id: GROUP_ID, name: "Viagem", kind: "group" },
  };
}

type Operation =
  | { kind: "edit"; totalCents: number; stale: boolean }
  | { kind: "delete" };

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    kind: fc.constant("edit" as const),
    totalCents: fc.integer({ min: 2, max: 500_000 }),
    stale: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("delete" as const) }),
);

describe("optimistic mutations under interleaved responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converges on the server ledger whatever order the responses land in", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(operation, { minLength: 2, maxLength: 4 }),
        async (scheduler, operations) => {
          const server: ServerState = {
            versionNo: 1,
            ledgerVersion: 1,
            status: "active",
            payload: payloadFor(10_000),
          };
          runSeq += 1;
          GROUP_ID = `group-race-${runSeq}`;
          EXPENSE_ID = `expense-race-${runSeq}`;

          useAppStore.setState({
            me: ME,
            groups: { [GROUP_ID]: snapshotOf(server) },
            groupOrder: [GROUP_ID],
            expenses: { [EXPENSE_ID]: summaryOf(server) },
            expenseDetails: { [EXPENSE_ID]: detailOf(server) },
          });

          function handle(fn: string, args: Record<string, unknown>): unknown {
            switch (fn) {
              case "edit_expense": {
                if (server.status === "deleted") throw new LedgerError("expense_deleted");
                if (args.p_expected_version_no !== server.versionNo) {
                  throw new LedgerError("stale_version");
                }
                server.versionNo += 1;
                server.ledgerVersion += 1;
                server.payload = args.p_payload as ExpensePayload;
                return {
                  groupId: GROUP_ID,
                  ledgerVersion: server.ledgerVersion,
                  eventId: null,
                  expenseId: EXPENSE_ID,
                  versionNo: server.versionNo,
                };
              }
              case "delete_expense": {
                if (server.status === "deleted") throw new LedgerError("expense_deleted");
                server.status = "deleted";
                server.ledgerVersion += 1;
                return { groupId: GROUP_ID, ledgerVersion: server.ledgerVersion, eventId: null };
              }
              case "get_group":
                return snapshotOf(server);
              case "get_expense":
                return detailOf(server);
              default:
                throw new Error(`unmocked rpc ${fn}`);
            }
          }

          // The server applies each call when it arrives, the way lock_group
          // serializes writers; only the responses are interleaved.
          vi.mocked(rpc).mockImplementation((fn: string, args: Record<string, unknown>) => {
            let settle: () => unknown;
            try {
              const value = handle(fn, args);
              settle = () => value;
            } catch (error) {
              settle = () => {
                throw error;
              };
            }
            return scheduler.schedule(Promise.resolve()).then(settle) as never;
          });

          const inFlight = operations.map((next) => {
            if (next.kind === "delete") {
              return deleteExpense(EXPENSE_ID).catch(() => undefined);
            }
            // A screen sends the version it is currently showing, which the
            // optimistic patch of an earlier concurrent edit has already moved.
            const shown = useAppStore.getState().expenses[EXPENSE_ID].versionNo;
            const expectedVersionNo = next.stale ? shown - 1 : shown;
            return editExpense({
              expenseId: EXPENSE_ID,
              expectedVersionNo,
              header: headerFor(next.totalCents),
              payload: payloadFor(next.totalCents),
            }).catch(() => undefined);
          });

          // refreshGroup queues a follow-up behind an in-flight refresh, so the
          // wait has to cover tasks that later tasks schedule.
          await scheduler.waitIdle();
          await Promise.all(inFlight);
          await scheduler.waitIdle();

          const stored = useAppStore.getState().groups[GROUP_ID];
          expect(stored.balances).toEqual(serverBalances(server));
          expect(stored.balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
          expect(stored.balances.every((row) => Number.isInteger(row.netCents))).toBe(true);
          expect(stored.balances.every((row) => row.netCents !== 0)).toBe(true);
        },
      ),
      propertyConfig(200),
    );
  });
});
