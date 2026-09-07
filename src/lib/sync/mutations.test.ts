import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExpenseHeader,
  ExpensePayload,
  GroupSnapshot,
  Me,
  MutationAck,
  Settlement,
  UserProfile,
} from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { rpc, rpcVoid } from "./client";
import { refreshExpense, refreshGroup } from "./refresh";
import {
  confirmSettlement,
  createExpense,
  deleteExpense,
  editExpense,
  markRead,
  notify,
  recordSettlement,
  restoreExpense,
  sendMessage,
  voidSettlement,
} from "./mutations";
import {
  acceptInvitation,
  claimGuest,
  confirmVendorCharge,
  createGroup,
  createInviteLink,
  deactivateInviteLink,
  declineInvitation,
  deleteGroup,
  getOrCreateDm,
  getVendorCharges,
  inviteMember,
  issueGuestClaimToken,
  joinViaLink,
  leaveGroup,
  lookupUserByHandle,
  recordVendorCharge,
  removeMember,
  updateProfile,
} from "./mutations-group";

vi.mock("@/lib/sync/client", () => ({
  rpc: vi.fn(),
  rpcVoid: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshGroup: vi.fn(async () => {}),
  refreshExpense: vi.fn(async () => {}),
  loadMoreExpenses: vi.fn(async () => {}),
  loadActivity: vi.fn(async () => {}),
  loadConversation: vi.fn(async () => {}),
}));

const ME: Me = {
  id: "user-me",
  handle: "me_user",
  name: "Eu Mesmo",
  avatarUrl: null,
  email: "me@example.com",
  pixKeyType: "email",
  pixKeyHint: "me@example.com",
  onboarded: true,
  notificationPreferences: { expenses: true, settlements: true, nudges: true },
};

const USER_2: UserProfile = {
  id: "user-2",
  handle: "amigo",
  name: "Amigo",
  avatarUrl: null,
};

function makeGroupSnapshot(groupId = "group-1"): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Viagem",
      creatorId: ME.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: [
      {
        groupId,
        userId: ME.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: "2026-01-01T00:00:00.000Z",
        user: ME,
      },
      {
        groupId,
        userId: USER_2.id,
        status: "accepted",
        invitedBy: ME.id,
        acceptedAt: "2026-01-01T00:00:00.000Z",
        user: USER_2,
      },
    ],
    balances: [
      { kind: "user", participantId: ME.id, netCents: 0 },
      { kind: "user", participantId: USER_2.id, netCents: 0 },
    ],
    guests: [],
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 10,
    unreadCount: 3,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
  };
}

const HEADER: ExpenseHeader = {
  occurredOn: "2026-01-02",
  title: "Almoço",
  merchantName: "Restaurante",
  expenseType: "single_amount",
  totalCents: 5000,
  serviceFeeBasisPoints: 0,
  fixedFeeCents: 0,
};

const PAYLOAD: ExpensePayload = {
  items: [],
  participants: [
    { kind: "user", userId: ME.id },
    { kind: "user", userId: USER_2.id },
  ],
  shares: [2500, 2500],
  payers: [{ participantIndex: 0, amountCents: 5000 }],
  itemAssignments: null,
};

describe("mutations", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("createExpense", () => {
    it("inserts optimistic summary and balances, replaces id on ack", async () => {
      const g1 = makeGroupSnapshot("g1");
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: { g1: { ids: [], oldestCursor: null, complete: true } },
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      const ack: MutationAck = {
        groupId: "g1",
        expenseId: "exp-ack-1",
        versionNo: 1,
        ledgerVersion: 2,
        eventId: 42,
      };
      vi.mocked(rpc).mockResolvedValueOnce(ack);

      const result = await createExpense({ groupId: "g1", header: HEADER, payload: PAYLOAD });

      expect(result).toEqual(ack);
      expect(rpc).toHaveBeenCalledWith(
        "create_expense",
        expect.objectContaining({
          p_group_id: "g1",
          p_occurred_on: HEADER.occurredOn,
          p_title: HEADER.title,
          p_merchant_name: HEADER.merchantName,
          p_expense_type: HEADER.expenseType,
          p_total_cents: HEADER.totalCents,
          p_service_fee_bps: HEADER.serviceFeeBasisPoints,
          p_fixed_fee_cents: HEADER.fixedFeeCents,
          p_payload: PAYLOAD,
        }),
        expect.any(Function),
      );

      const state = useAppStore.getState();
      expect(state.expenses["exp-ack-1"]).toBeDefined();
      expect(state.expenses["exp-ack-1"]?.title).toBe(HEADER.title);
      expect(state.expenses["exp-ack-1"]?.myShareCents).toBe(2500);
      expect(state.expenses["exp-ack-1"]?.myPaidCents).toBe(5000);
      expect(state.expenseLists.g1?.ids).toEqual(["exp-ack-1"]);

      const meBalance = state.groups.g1?.balances.find((b) => b.participantId === ME.id);
      const u2Balance = state.groups.g1?.balances.find((b) => b.participantId === USER_2.id);
      expect(meBalance?.netCents).toBe(2500);
      expect(u2Balance?.netCents).toBe(-2500);

      expect(refreshGroup).toHaveBeenCalledWith("g1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/notify",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ eventId: 42 }),
          keepalive: true,
        }),
      );
    });

    it("restores exact previous expenses, expenseLists, and balances on rejection", async () => {
      const g1 = makeGroupSnapshot("g1");
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: { g1: { ids: ["old-exp"], oldestCursor: null, complete: true } },
        expenses: {
          "old-exp": {
            id: "old-exp",
            groupId: "g1",
            creatorId: ME.id,
            status: "active",
            occurredOn: "2026-01-01",
            createdAt: "2026-01-01T00:00:00.000Z",
            versionNo: 1,
            title: "Antiga",
            merchantName: null,
            expenseType: "single_amount",
            totalCents: 1000,
            myShareCents: 500,
            myPaidCents: 1000,
            participantCount: 2,
          },
        },
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      const prevExpenses = useAppStore.getState().expenses;
      const prevExpenseLists = useAppStore.getState().expenseLists;
      const prevBalances = useAppStore.getState().groups.g1?.balances;

      vi.mocked(rpc).mockRejectedValueOnce(new Error("network"));

      await expect(
        createExpense({ groupId: "g1", header: HEADER, payload: PAYLOAD }),
      ).rejects.toThrow("network");

      const state = useAppStore.getState();
      expect(state.expenses).toBe(prevExpenses);
      expect(state.expenseLists).toBe(prevExpenseLists);
      expect(state.groups.g1?.balances).toBe(prevBalances);
    });
  });

  describe("confirmSettlement", () => {
    it("applies the settlement delta optimistically and rolls back on failure", async () => {
      const pending: Settlement = {
        id: "settle-1",
        operationId: "op-1",
        groupId: "g1",
        fromUserId: USER_2.id,
        toUserId: ME.id,
        amountCents: 1500,
        status: "pending",
        createdBy: USER_2.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        confirmedAt: null,
        voidedAt: null,
        voidedBy: null,
      };

      const g1 = makeGroupSnapshot("g1");
      g1.pendingSettlements = [pending];
      g1.balances = [
        { kind: "user", participantId: ME.id, netCents: 1500 },
        { kind: "user", participantId: USER_2.id, netCents: -1500 },
      ];

      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      const prevBalances = useAppStore.getState().groups.g1?.balances;
      const prevPending = useAppStore.getState().groups.g1?.pendingSettlements;

      vi.mocked(rpc).mockRejectedValueOnce(new Error("settlement_not_pending"));

      await expect(confirmSettlement("g1", "settle-1")).rejects.toThrow("settlement_not_pending");

      const stateAfterFail = useAppStore.getState();
      expect(stateAfterFail.groups.g1?.pendingSettlements).toBe(prevPending);
      expect(stateAfterFail.groups.g1?.balances).toBe(prevBalances);

      const ack: MutationAck = { groupId: "g1", settlementId: "settle-1", ledgerVersion: 3, eventId: 50 };
      vi.mocked(rpc).mockResolvedValueOnce(ack);

      const successAck = await confirmSettlement("g1", "settle-1");
      expect(successAck).toEqual(ack);

      const stateAfterSuccess = useAppStore.getState();
      expect(stateAfterSuccess.groups.g1?.pendingSettlements).toHaveLength(0);
      expect(stateAfterSuccess.groups.g1?.balances).toEqual([]);
      expect(refreshGroup).toHaveBeenCalledWith("g1");
    });
  });

  describe("sendMessage", () => {
    it("replaces the optimistic message by clientId", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {
          g1: {
            messages: [
              {
                id: "msg-old",
                clientId: "msg-old-client",
                groupId: "g1",
                senderId: USER_2.id,
                content: "Oi",
                createdAt: "2026-01-01T00:00:00.000Z",
                sender: USER_2,
              },
            ],
            events: [],
            oldestCursor: "2026-01-01T00:00:00.000Z",
          },
        },
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockImplementationOnce(async (_name, args) => {
        const clientId = args.p_client_id as string;
        return {
          id: "msg-server-id",
          clientId,
          groupId: "g1",
          senderId: ME.id,
          content: "Tudo bem?",
          createdAt: "2026-01-01T00:01:00.000Z",
          sender: ME,
        };
      });

      const message = await sendMessage("g1", "Tudo bem?");
      expect(message.id).toBe("msg-server-id");

      const conversation = useAppStore.getState().conversations.g1;
      expect(conversation?.messages).toHaveLength(2);
      expect(conversation?.messages.map((m) => m.id)).toEqual(["msg-old", "msg-server-id"]);
      expect(conversation?.messages[1]?.clientId).toBe(message.clientId);
    });

    it("rolls back optimistic message on failure", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {
          g1: {
            messages: [],
            events: [],
            oldestCursor: null,
          },
        },
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      const prevConversations = useAppStore.getState().conversations;
      vi.mocked(rpc).mockRejectedValueOnce(new Error("network"));

      await expect(sendMessage("g1", "Falha")).rejects.toThrow("network");

      expect(useAppStore.getState().conversations).toBe(prevConversations);
    });
  });

  describe("editExpense", () => {
    it("updates summary and balances and handles rollback on failure", async () => {
      const g1 = makeGroupSnapshot("g1");
      g1.balances = [
        { kind: "user", participantId: ME.id, netCents: 2500 },
        { kind: "user", participantId: USER_2.id, netCents: -2500 },
      ];

      const initialSummary = {
        id: "exp-1",
        groupId: "g1",
        creatorId: ME.id,
        status: "active" as const,
        occurredOn: "2026-01-02",
        createdAt: "2026-01-02T00:00:00.000Z",
        versionNo: 1,
        title: "Almoço",
        merchantName: null,
        expenseType: "single_amount" as const,
        totalCents: 5000,
        myShareCents: 2500,
        myPaidCents: 5000,
        participantCount: 2,
      };

      const detail = {
        expense: {
          id: "exp-1",
          groupId: "g1",
          creatorId: ME.id,
          status: "active" as const,
          currentVersionNo: 1,
          occurredOn: "2026-01-02",
          createdAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
          deletedBy: null,
        },
        current: {
          expenseId: "exp-1",
          versionNo: 1,
          authorId: ME.id,
          createdAt: "2026-01-02T00:00:00.000Z",
          ...HEADER,
          payload: PAYLOAD,
          changeSummary: null,
        },
        versions: [],
        participants: [],
        group: { id: "g1", name: "Viagem", kind: "group" as const },
      };

      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: { g1: { ids: ["exp-1"], oldestCursor: null, complete: true } },
        expenses: { "exp-1": initialSummary },
        expenseDetails: { "exp-1": detail },
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      const newHeader: ExpenseHeader = { ...HEADER, totalCents: 8000 };
      const newPayload: ExpensePayload = {
        ...PAYLOAD,
        shares: [4000, 4000],
        payers: [{ participantIndex: 0, amountCents: 8000 }],
      };

      vi.mocked(rpc).mockRejectedValueOnce(new Error("stale_version"));

      const prevExpenses = useAppStore.getState().expenses;
      await expect(
        editExpense({
          expenseId: "exp-1",
          expectedVersionNo: 1,
          header: newHeader,
          payload: newPayload,
        }),
      ).rejects.toThrow("stale_version");
      expect(useAppStore.getState().expenses).toBe(prevExpenses);

      vi.mocked(rpc).mockResolvedValueOnce({
        groupId: "g1",
        expenseId: "exp-1",
        versionNo: 2,
        ledgerVersion: 3,
        eventId: 55,
      });

      const ack = await editExpense({
        expenseId: "exp-1",
        expectedVersionNo: 1,
        header: newHeader,
        payload: newPayload,
      });

      expect(ack.versionNo).toBe(2);
      expect(refreshExpense).toHaveBeenCalledWith("exp-1");
      expect(refreshGroup).toHaveBeenCalledWith("g1");
      const meBalance = useAppStore.getState().groups.g1?.balances.find((b) => b.participantId === ME.id);
      expect(meBalance?.netCents).toBe(4000);
    });
  });

  describe("deleteExpense and restoreExpense", () => {
    it("flips status and balances on delete and restore", async () => {
      const g1 = makeGroupSnapshot("g1");
      g1.balances = [
        { kind: "user", participantId: ME.id, netCents: 2500 },
        { kind: "user", participantId: USER_2.id, netCents: -2500 },
      ];

      const summary = {
        id: "exp-1",
        groupId: "g1",
        creatorId: ME.id,
        status: "active" as const,
        occurredOn: "2026-01-02",
        createdAt: "2026-01-02T00:00:00.000Z",
        versionNo: 1,
        title: "Almoço",
        merchantName: null,
        expenseType: "single_amount" as const,
        totalCents: 5000,
        myShareCents: 2500,
        myPaidCents: 5000,
        participantCount: 2,
      };

      const detail = {
        expense: {
          id: "exp-1",
          groupId: "g1",
          creatorId: ME.id,
          status: "active" as const,
          currentVersionNo: 1,
          occurredOn: "2026-01-02",
          createdAt: "2026-01-02T00:00:00.000Z",
          deletedAt: null,
          deletedBy: null,
        },
        current: {
          expenseId: "exp-1",
          versionNo: 1,
          authorId: ME.id,
          createdAt: "2026-01-02T00:00:00.000Z",
          ...HEADER,
          payload: PAYLOAD,
          changeSummary: null,
        },
        versions: [],
        participants: [],
        group: { id: "g1", name: "Viagem", kind: "group" as const },
      };

      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: { g1: { ids: ["exp-1"], oldestCursor: null, complete: true } },
        expenses: { "exp-1": summary },
        expenseDetails: { "exp-1": detail },
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({
        groupId: "g1",
        expenseId: "exp-1",
        versionNo: 1,
        ledgerVersion: 3,
        eventId: 60,
      });

      await deleteExpense("exp-1");

      expect(useAppStore.getState().expenses["exp-1"]?.status).toBe("deleted");
      expect(useAppStore.getState().groups.g1?.balances).toEqual([]);

      vi.mocked(rpc).mockResolvedValueOnce({
        groupId: "g1",
        expenseId: "exp-1",
        versionNo: 1,
        ledgerVersion: 4,
        eventId: 61,
      });

      await restoreExpense("exp-1");

      expect(useAppStore.getState().expenses["exp-1"]?.status).toBe("active");
      const meBalance = useAppStore.getState().groups.g1?.balances.find((b) => b.participantId === ME.id);
      expect(meBalance?.netCents).toBe(2500);
    });
  });

  describe("recordSettlement and voidSettlement", () => {
    it("records a pending settlement and replaces its id after ack", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({
        groupId: "g1",
        settlementId: "settle-server-1",
        ledgerVersion: 1,
        eventId: 70,
      });

      const ack = await recordSettlement({ groupId: "g1", toUserId: USER_2.id, amountCents: 2000 });
      expect(ack.settlementId).toBe("settle-server-1");

      const pending = useAppStore.getState().groups.g1?.pendingSettlements;
      expect(pending).toHaveLength(1);
      expect(pending?.[0]?.id).toBe("settle-server-1");
      expect(pending?.[0]?.amountCents).toBe(2000);
    });

    it("voids a pending settlement and confirmed settlement", async () => {
      const g1 = makeGroupSnapshot("g1");
      g1.pendingSettlements = [
        {
          id: "s-pending",
          operationId: "op-pending",
          groupId: "g1",
          fromUserId: ME.id,
          toUserId: USER_2.id,
          amountCents: 1000,
          status: "pending",
          createdBy: ME.id,
          createdAt: "2026-01-01T00:00:00.000Z",
          confirmedAt: null,
          voidedAt: null,
          voidedBy: null,
        },
      ];

      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1 },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({
        groupId: "g1",
        settlementId: "s-pending",
        ledgerVersion: 1,
        eventId: 80,
      });

      await voidSettlement("g1", "s-pending", false);
      expect(useAppStore.getState().groups.g1?.pendingSettlements).toHaveLength(0);
    });
  });

  describe("markRead", () => {
    it("optimistically zeroes unreadCount and rolls back on failure", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      expect(useAppStore.getState().groups.g1?.unreadCount).toBe(3);

      vi.mocked(rpcVoid).mockRejectedValueOnce(new Error("failed"));
      await expect(markRead("g1")).rejects.toThrow("failed");
      expect(useAppStore.getState().groups.g1?.unreadCount).toBe(3);

      vi.mocked(rpcVoid).mockResolvedValueOnce(undefined);
      await markRead("g1");
      expect(useAppStore.getState().groups.g1?.unreadCount).toBe(0);
      expect(rpcVoid).toHaveBeenCalledWith("mark_read", { p_group_id: "g1" });
    });
  });

  describe("notify", () => {
    it("does nothing if eventId is null and swallows fetch failure", async () => {
      notify(null);
      expect(globalThis.fetch).not.toHaveBeenCalled();

      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("404"));
      expect(() => notify(123)).not.toThrow();
    });
  });

  describe("group mutations", () => {
    it("creates group and awaits refreshGroup", async () => {
      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "new-g", ledgerVersion: 1, eventId: 100 });
      const ack = await createGroup("Novo Grupo", [USER_2.id]);
      expect(ack.groupId).toBe("new-g");
      expect(refreshGroup).toHaveBeenCalledWith("new-g");
    });

    it("invites, accepts, and declines membership", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 101 });
      await inviteMember("g1", USER_2.id);

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 102 });
      await acceptInvitation("g1");

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: null });
      await declineInvitation("g1");
      expect(useAppStore.getState().groups.g1).toBeUndefined();
    });

    it("leaves and deletes group", async () => {
      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 103 });
      await leaveGroup("g1");
      expect(useAppStore.getState().groups.g1).toBeUndefined();

      useAppStore.setState({
        hydrated: true,
        me: ME,
        groups: { g1: makeGroupSnapshot("g1") },
        groupOrder: ["g1"],
        expenseLists: {},
        expenses: {},
        expenseDetails: {},
        activity: { items: [], oldestId: null },
        conversations: {},
        lastBootstrapAt: "2026-01-01T00:00:00.000Z",
      });

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1" });
      await deleteGroup("g1");
      expect(useAppStore.getState().groups.g1).toBeUndefined();
    });

    it("creates DM, links, and updates profile", async () => {
      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "dm-1", ledgerVersion: 1, eventId: null, created: true });
      const dm = await getOrCreateDm(USER_2.id);
      expect(dm).toEqual({ groupId: "dm-1", created: true });

      const link = { groupId: "g1", token: "tok123", expiresAt: null, maxUses: null };
      vi.mocked(rpc).mockResolvedValueOnce(link);
      const createdLink = await createInviteLink("g1", null, null);
      expect(createdLink).toEqual(link);

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1" });
      await deactivateInviteLink("g1");

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 104 });
      await joinViaLink("tok123");

      const updatedMe = { ...ME, name: "Novo Nome" };
      vi.mocked(rpc).mockResolvedValueOnce(updatedMe);
      const resMe = await updateProfile({ name: "Novo Nome" });
      expect(resMe.name).toBe("Novo Nome");
      expect(useAppStore.getState().me?.name).toBe("Novo Nome");
    });

    it("looks up user, issues and claims guest token, and manages vendor charges", async () => {
      vi.mocked(rpc).mockResolvedValueOnce(USER_2);
      const user = await lookupUserByHandle("amigo");
      expect(user).toEqual(USER_2);

      vi.mocked(rpc).mockResolvedValueOnce("token-abc");
      const tok = await issueGuestClaimToken("guest-1");
      expect(tok).toBe("token-abc");

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 105 });
      await claimGuest("token-abc");

      const charge = {
        id: "vc-1",
        userId: ME.id,
        amountCents: 500,
        description: "Taxa",
        status: "pending" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        confirmedAt: null,
      };

      vi.mocked(rpc).mockResolvedValueOnce(charge);
      const rec = await recordVendorCharge(500, "Taxa");
      expect(rec).toEqual(charge);

      vi.mocked(rpc).mockResolvedValueOnce({ ...charge, status: "received" as const });
      const conf = await confirmVendorCharge("vc-1");
      expect(conf.status).toBe("received");

      vi.mocked(rpc).mockResolvedValueOnce([charge]);
      const list = await getVendorCharges(10);
      expect(list).toEqual([charge]);

      vi.mocked(rpc).mockResolvedValueOnce({ groupId: "g1", ledgerVersion: 1, eventId: 106 });
      await removeMember("g1", USER_2.id);
    });
  });
});
