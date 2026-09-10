import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerError } from "@/lib/sync/errors";
import { makeGroupMember } from "@/test/fixtures";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useInvitationActions } from "./use-invitation-actions";

const { mockAccept, mockDecline, mockToast } = vi.hoisted(() => ({
  mockAccept: vi.fn(),
  mockDecline: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  acceptInvitation: mockAccept,
  declineInvitation: mockDecline,
}));

vi.mock("react-hot-toast", () => ({
  default: mockToast,
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function invitedSnapshot(groupId: string): GroupSnapshot {
  const inviter = makeGroupMember("user-2", "Bruno");
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Viagem",
      creatorId: "user-2",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      inviter,
      {
        ...makeGroupMember("user-1", "Alice"),
        status: "invited",
        invitedBy: "user-2",
        acceptedAt: null,
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().reset();
  useAppStore.setState({
    me,
    groups: { g1: invitedSnapshot("g1") },
    groupOrder: ["g1"],
  });
});

describe("useInvitationActions", () => {
  it("accept toasts success only after the mutation resolves", async () => {
    const { promise: acceptPromise, resolve: resolveAccept } = Promise.withResolvers<unknown>();
    mockAccept.mockReturnValueOnce(acceptPromise);

    const { result } = renderHook(() => useInvitationActions());

    let accept!: Promise<void>;
    await act(async () => {
      accept = result.current.accept("g1");
    });

    expect(mockAccept).toHaveBeenCalledWith("g1");
    expect(result.current.pendingGroupId).toBe("g1");
    expect(mockToast.success).not.toHaveBeenCalled();

    await act(async () => {
      resolveAccept({ eventId: 1 });
      await accept;
    });

    expect(mockToast.success).toHaveBeenCalledWith("Convite aceito");
    expect(result.current.pendingGroupId).toBeNull();
  });

  it("accept failure toasts the ledger message and does not touch the store", async () => {
    mockAccept.mockRejectedValueOnce(new LedgerError("not_invited"));
    const groupsBefore = useAppStore.getState().groups;

    const { result } = renderHook(() => useInvitationActions());

    await act(async () => {
      await result.current.accept("g1");
    });

    expect(mockToast.error).toHaveBeenCalledWith("Essa pessoa não tem convite pendente.");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(useAppStore.getState().groups).toBe(groupsBefore);
    expect(useAppStore.getState().groups.g1?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: me.id, status: "invited" }),
      ]),
    );
    expect(result.current.pendingGroupId).toBeNull();
  });

  it("decline toasts success without refreshing the group", async () => {
    mockDecline.mockResolvedValueOnce({ eventId: 2 });

    const { result } = renderHook(() => useInvitationActions());

    await act(async () => {
      await result.current.decline("g1");
    });

    expect(mockDecline).toHaveBeenCalledWith("g1");
    expect(mockToast.success).toHaveBeenCalledWith("Convite recusado");
    expect(result.current.pendingGroupId).toBeNull();
  });

  it("decline failure toasts the ledger message and does not touch the store", async () => {
    mockDecline.mockRejectedValueOnce(new LedgerError("network"));
    const groupsBefore = useAppStore.getState().groups;

    const { result } = renderHook(() => useInvitationActions());

    await act(async () => {
      await result.current.decline("g1");
    });

    expect(mockToast.error).toHaveBeenCalledWith("Sem conexão. Tente de novo quando a internet voltar.");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(useAppStore.getState().groups).toBe(groupsBefore);
    expect(result.current.pendingGroupId).toBeNull();
  });
});
