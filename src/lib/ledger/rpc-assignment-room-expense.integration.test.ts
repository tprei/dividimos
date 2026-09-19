import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

type Client = SupabaseClient<Database>;

interface RoomView {
  role: "host" | "participant";
  room: {
    id: string;
    revision: number;
    status: string;
    selfParticipantId: string;
    items: Array<{ id: string; revision: number }>;
    participants: Array<{ id: string; ordinal: number; displayName: string }>;
    currentBill: null | {
      status: "active" | "deleted";
      versionNo: number;
      items: Json[];
      itemAssignments: Json[] | null;
      participants: Json[];
      shares: number[];
      payers: Json[];
      totalCents: number;
    };
  };
}

interface ExpenseDetail {
  expense: { id: string; currentVersionNo: number; status: string };
  current: {
    occurredOn: string;
    title: string;
    merchantName: string | null;
    expenseType: "itemized" | "single_amount";
    totalCents: number;
    serviceFeeBasisPoints: number;
    fixedFeeCents: number;
    payload: Record<string, Json | undefined>;
  };
}

interface Setup {
  roomId: string;
  expenseId: string;
  groupId: string;
  guestToken: string;
  closedRevision: number;
}

function capability(prefix: "armj1" | "armm1"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}AAAAAAAAAAA`;
}

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

describe.skipIf(!isIntegrationTestReady)(
  "recorded assignment room expense access",
  () => {
    let host: TestUser;
    let member: TestUser;
    let hostClient: Client;
    let memberClient: Client;
    let anonClient: Client;

    beforeAll(async () => {
      [host, member] = await createTestUsers(2);
      hostClient = authenticateAs(host);
      memberClient = authenticateAs(member);
      anonClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
    });

    async function finalizedRoom(): Promise<Setup> {
      const groupId = await createGroupWithMembers(host, [member], "Mesa");
      const roomId = crypto.randomUUID();
      const joinToken = capability("armj1");
      const created = await rpc<RoomView>(hostClient, "create_assignment_room", {
        p_room_id: roomId,
        p_group_target: { kind: "existing", groupId },
        p_header: {
          title: "Prato compartilhado",
          occurredOn: "2026-09-19",
          serviceFeeBasisPoints: 0,
          fixedFeeCents: 0,
        },
        p_items: [
          {
            description: "Prato",
            quantityMilliunits: 1_000,
            unitPriceCents: 100,
            totalPriceCents: 100,
          },
        ],
        p_participants: [
          { id: crypto.randomUUID(), displayName: host.name, userId: host.id },
          { id: crypto.randomUUID(), displayName: member.name, userId: member.id },
        ],
        p_join_token: joinToken,
      });
      const memberToken = capability("armm1");
      const memberView = await rpc<RoomView>(memberClient, "join_assignment_room", {
        p_room_id: roomId,
        p_join_token: joinToken,
        p_member_token: memberToken,
        p_display_name: member.name,
      });
      const guestToken = capability("armm1");
      const guestView = await rpc<RoomView>(anonClient, "join_assignment_room", {
        p_room_id: roomId,
        p_join_token: joinToken,
        p_member_token: guestToken,
        p_display_name: "Convidada",
      });
      const itemId = created.room.items[0].id;
      let view = await rpc<RoomView>(hostClient, "set_assignment_room_claim", {
        p_room_id: roomId,
        p_member_token: null,
        p_item_id: itemId,
        p_participant_id: created.room.selfParticipantId,
        p_expected_item_revision: 1,
        p_ticks: 40_000,
      });
      view = await rpc<RoomView>(memberClient, "set_assignment_room_claim", {
        p_room_id: roomId,
        p_member_token: memberToken,
        p_item_id: itemId,
        p_participant_id: memberView.room.selfParticipantId,
        p_expected_item_revision: view.room.items[0].revision,
        p_ticks: 40_000,
      });
      view = await rpc<RoomView>(anonClient, "set_assignment_room_claim", {
        p_room_id: roomId,
        p_member_token: guestToken,
        p_item_id: itemId,
        p_participant_id: guestView.room.selfParticipantId,
        p_expected_item_revision: view.room.items[0].revision,
        p_ticks: 40_000,
      });
      const closed = await rpc<RoomView>(hostClient, "close_assignment_room", {
        p_room_id: roomId,
        p_expected_revision: view.room.revision,
      });
      const finalized = await rpc<{
        ack: { expenseId: string };
      }>(hostClient, "finalize_assignment_room", {
        p_room_id: roomId,
        p_expected_revision: closed.room.revision,
        p_payload: {
          items: [
            {
              description: "Prato",
              quantityMilliunits: 1_000,
              unitPriceCents: 100,
              totalPriceCents: 100,
            },
          ],
          participants: [
            { kind: "user", userId: host.id },
            { kind: "user", userId: member.id },
            { kind: "guest", guestId: null, displayName: "Convidada" },
          ],
          shares: [34, 33, 33],
          payers: [{ participantIndex: 0, amountCents: 100 }],
          itemAssignments: [
            { itemIndex: 0, participantIndex: 0, amountCents: 34 },
            { itemIndex: 0, participantIndex: 1, amountCents: 33 },
            { itemIndex: 0, participantIndex: 2, amountCents: 33 },
          ],
          splitMethod: null,
        },
      });
      return {
        roomId,
        expenseId: finalized.ack.expenseId,
        groupId,
        guestToken,
        closedRevision: closed.room.revision,
      };
    }

    it("returns one context read and projects the host's current edit to room members", async () => {
      const setup = await finalizedRoom();
      const oldDetail = await rpc<ExpenseDetail>(hostClient, "get_expense", {
        p_expense_id: setup.expenseId,
      });
      const context = await rpc<{
        detail: ExpenseDetail;
        assignmentRoom: { id: string; hostUserId: string };
      }>(hostClient, "get_expense_context", {
        p_expense_id: setup.expenseId,
      });
      expect(context.detail).toEqual(oldDetail);
      expect(context.assignmentRoom).toEqual({ id: setup.roomId, hostUserId: host.id });

      const payload = {
        ...oldDetail.current.payload,
        shares: [40, 30, 30],
        itemAssignments: [
          { itemIndex: 0, participantIndex: 0, amountCents: 40 },
          { itemIndex: 0, participantIndex: 1, amountCents: 30 },
          { itemIndex: 0, participantIndex: 2, amountCents: 30 },
        ],
      };
      await rpc(hostClient, "edit_expense", {
        p_expense_id: setup.expenseId,
        p_expected_version_no: oldDetail.expense.currentVersionNo,
        p_occurred_on: oldDetail.current.occurredOn,
        p_title: oldDetail.current.title,
        p_merchant_name: oldDetail.current.merchantName,
        p_expense_type: "itemized",
        p_total_cents: 100,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: payload,
      });
      const guestView = await rpc<RoomView>(anonClient, "get_assignment_room", {
        p_room_id: setup.roomId,
        p_member_token: setup.guestToken,
      });
      expect(guestView.room.currentBill).toMatchObject({
        status: "active",
        versionNo: 2,
        shares: [40, 30, 30],
        itemAssignments: payload.itemAssignments,
      });
      await withPg(async (db) => {
        await db.query(
          "update public.expense_versions set payload = jsonb_set(payload, '{itemAssignments}', 'null'::jsonb) where expense_id = $1 and version_no = 2",
          [setup.expenseId]
        );
      });
      const aggregateOnly = await rpc<RoomView>(
        anonClient,
        "get_assignment_room",
        {
          p_room_id: setup.roomId,
          p_member_token: setup.guestToken,
        }
      );
      expect(aggregateOnly.room.currentBill).toMatchObject({
        itemAssignments: null,
        shares: [40, 30, 30],
      });
      expect(JSON.stringify(guestView)).not.toContain(setup.groupId);
      expect(JSON.stringify(guestView)).not.toContain(setup.expenseId);
    });

    it("reserves linked mutations for the host and redacts deleted bills", async () => {
      const setup = await finalizedRoom();
      const detail = await rpc<ExpenseDetail>(hostClient, "get_expense", {
        p_expense_id: setup.expenseId,
      });
      const editArgs = {
        p_expense_id: setup.expenseId,
        p_expected_version_no: detail.expense.currentVersionNo,
        p_occurred_on: detail.current.occurredOn,
        p_title: detail.current.title,
        p_merchant_name: detail.current.merchantName as never,
        p_expense_type: "itemized" as const,
        p_total_cents: 100,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: detail.current.payload,
      };
      expect(await expectRpcError(memberClient.rpc("edit_expense", editArgs))).toContain(
        "room_host_required"
      );
      expect(
        await expectRpcError(
          memberClient.rpc("delete_expense", { p_expense_id: setup.expenseId })
        )
      ).toContain("room_host_required");
      expect(
        await expectRpcError(
          hostClient.rpc("edit_expense", {
            ...editArgs,
            p_expense_type: "single_amount",
            p_payload: { ...detail.current.payload, itemAssignments: null },
          })
        )
      ).toContain("invalid_payload");

      await rpc(hostClient, "delete_expense", { p_expense_id: setup.expenseId });
      const deleted = await rpc<RoomView>(anonClient, "get_assignment_room", {
        p_room_id: setup.roomId,
        p_member_token: setup.guestToken,
      });
      expect(deleted.room.currentBill).toMatchObject({
        status: "deleted",
        items: [],
        participants: [],
        shares: [],
        payers: [],
        totalCents: 0,
      });
      expect(
        await expectRpcError(
          memberClient.rpc("restore_expense", { p_expense_id: setup.expenseId })
        )
      ).toContain("room_host_required");
      await rpc(hostClient, "restore_expense", { p_expense_id: setup.expenseId });
    });

    it("keeps ordinary expense party edits unchanged", async () => {
      const groupId = await createGroupWithMembers(host, [member], "Comum");
      const created = await rpc<{ expenseId: string }>(hostClient, "create_expense", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_occurred_on: "2026-09-19",
        p_title: "Despesa comum",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 100,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: host.id },
            { kind: "user", userId: member.id },
          ],
          shares: [50, 50],
          payers: [{ participantIndex: 0, amountCents: 100 }],
          itemAssignments: null,
          splitMethod: "fixed",
        },
        p_chave_acesso: null,
      });
      const ack = await rpc<{ versionNo: number }>(memberClient, "edit_expense", {
        p_expense_id: created.expenseId,
        p_expected_version_no: 1,
        p_occurred_on: "2026-09-19",
        p_title: "Despesa comum corrigida",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 100,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: host.id },
            { kind: "user", userId: member.id },
          ],
          shares: [40, 60],
          payers: [{ participantIndex: 0, amountCents: 100 }],
          itemAssignments: null,
          splitMethod: "fixed",
        },
      });
      expect(ack.versionNo).toBe(2);
    });
  }
);
