import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { useAssignmentRoomEntry } from "./use-assignment-room-entry";

const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/sync/assignment-rooms", () => ({ createAssignmentRoom: mocks.create }));

const roomView = {
  role: "host",
  groupTarget: { kind: "new", name: "Mercado" },
  participantRefs: [],
  room: {
    id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    status: "open",
    title: "Mercado",
    occurredOn: "2026-09-19",
    serviceFeeBasisPoints: 1_000,
    fixedFeeCents: 50,
    totalCents: 2_250,
    selfParticipantId: "participant-host",
    items: [],
    participants: [],
    claims: [],
    topic: null,
    currentBill: null,
  },
} satisfies AssignmentRoomView;

const receipt = {
  merchant: " Mercado ",
  items: [
    {
      description: "Café",
      quantity: 2_000,
      unitPriceCents: 1_000,
      totalCents: 2_000,
    },
  ],
  serviceFeeBasisPoints: 1_000,
  fixedFeesCents: 50,
  totalCents: 2_250,
};

describe("useAssignmentRoomEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue(roomView);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000009",
    );
  });

  it("creates a one-host room from the reviewed receipt without touching a draft", async () => {
    const { result } = renderHook(() =>
      useAssignmentRoomEntry({
        host: { id: "user-host", name: "Ana" },
        groupId: null,
      }),
    );

    await act(() => result.current.shareReceipt(receipt, "2026-09-19"));

    expect(mocks.create).toHaveBeenCalledWith({
      groupTarget: { kind: "new", name: "Mercado" },
      header: {
        title: "Mercado",
        occurredOn: "2026-09-19",
        serviceFeeBasisPoints: 1_000,
        fixedFeeCents: 50,
      },
      items: [
        {
          description: "Café",
          quantityMilliunits: 2_000,
          unitPriceCents: 1_000,
          totalPriceCents: 2_000,
        },
      ],
      participants: [
        {
          id: "00000000-0000-4000-8000-000000000009",
          displayName: "Ana",
          userId: "user-host",
        },
      ],
    });
    expect(mocks.push).toHaveBeenCalledWith(`/room/${roomView.room.id}?invite=1`);
  });

  it("uses an existing group target and surfaces creation failure", async () => {
    mocks.create.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useAssignmentRoomEntry({
        host: { id: "user-host", name: "Ana" },
        groupId: "group-1",
      }),
    );

    await act(() => result.current.shareReceipt({ ...receipt, merchant: null }, "2026-09-19"));

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ groupTarget: { kind: "existing", groupId: "group-1" } }),
    );
    expect(result.current.error).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
