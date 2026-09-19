import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { LedgerError } from "./errors";

const mocks = vi.hoisted(() => ({
  authGeneration: 1,
  rpc: vi.fn(),
  refreshGroup: vi.fn(),
}));

vi.mock("./client", () => ({
  getAuthGeneration: () => mocks.authGeneration,
  rpc: mocks.rpc,
}));
vi.mock("./refresh", () => ({ refreshGroup: mocks.refreshGroup }));

import {
  cancelAssignmentRoom,
  clearAssignmentRoomAccess,
  finalizeAssignmentRoom,
  getAssignmentRoomMemberToken,
  joinAssignmentRoom,
  resetAssignmentRoomRuntime,
  setAssignmentRoomClaim,
} from "./assignment-rooms";
import { useAssignmentRoomStore } from "@/stores/assignment-room-store";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000003";
const JOIN_TOKEN = `armj1_${"A".repeat(43)}`;

function view(revision: number, status: "open" | "cancelled" = "open"): AssignmentRoomView {
  return {
    role: "participant",
    room: {
      id: ROOM_ID,
      revision,
      status,
      title: "Almoço",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      totalCents: 100,
      selfParticipantId: PARTICIPANT_ID,
      items: [
        {
          id: ITEM_ID,
          ordinal: 0,
          revision,
          description: "Prato",
          quantityMilliunits: 1_000,
          unitPriceCents: 100,
          totalPriceCents: 100,
        },
      ],
      participants: [],
      claims: [],
      topic: `assignment:${ROOM_ID}:${"B".repeat(43)}`,
      currentBill: null,
    },
  };
}

function decodeThrough<T>(value: T) {
  return async (_name: string, _args: unknown, decode: (raw: unknown) => unknown) => {
    const decoded = decode(value) as { ok: boolean; value?: T };
    if (!decoded.ok) throw new Error("fixture failed decoding");
    return decoded.value;
  };
}

describe("assignment room sync", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.authGeneration = 1;
    mocks.rpc.mockReset();
    mocks.refreshGroup.mockReset();
    resetAssignmentRoomRuntime();
  });

  it("persists a minted member capability before dispatch and consumes the join secret", async () => {
    mocks.rpc.mockImplementation(
      async (_name, args: { p_room_id: string; p_member_token: string }, decode) => {
        expect(getAssignmentRoomMemberToken(args.p_room_id)).toBe(args.p_member_token);
        return (decode(view(2)) as { value: AssignmentRoomView }).value;
      }
    );

    await joinAssignmentRoom({ roomId: ROOM_ID, joinToken: JOIN_TOKEN, displayName: "Bia" });

    expect(getAssignmentRoomMemberToken(ROOM_ID)).toMatch(
      /^armm1_[A-Za-z0-9_-]{43}$/
    );
    const stored = localStorage.getItem(`dividimos.assignment-room.${ROOM_ID}`);
    expect(stored).not.toContain(JOIN_TOKEN);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].view?.room.topic).toBeNull();
  });

  it("fails before dispatch when room-scoped persistence fails", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    await expect(
      joinAssignmentRoom({ roomId: ROOM_ID, joinToken: JOIN_TOKEN, displayName: "Bia" })
    ).rejects.toMatchObject({ code: "invalid_token" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("removes denied room state even when credential storage cleanup fails", () => {
    useAssignmentRoomStore.getState().install(view(2));
    const removeItem = vi
      .spyOn(window.localStorage, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });

    expect(() => clearAssignmentRoomAccess(ROOM_ID)).toThrow();
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID]).toBeUndefined();
    removeItem.mockRestore();
  });

  it("fails before dispatch when secure randomness is unavailable", async () => {
    const getRandomValues = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(() => {
        throw new Error("secure randomness unavailable");
      });

    await expect(
      joinAssignmentRoom({ roomId: ROOM_ID, joinToken: JOIN_TOKEN, displayName: "Bia" })
    ).rejects.toMatchObject({ code: "invalid_token" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    getRandomValues.mockRestore();
  });

  it("recovers a lost join response with the persisted member capability", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new LedgerError("network"))
      .mockImplementationOnce(decodeThrough(view(2)));

    await expect(
      joinAssignmentRoom({ roomId: ROOM_ID, joinToken: JOIN_TOKEN, displayName: "Bia" })
    ).resolves.toEqual(view(2));

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "join_assignment_room",
      "refresh_assignment_room_member",
    ]);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toMatch(
      /^armm1_[A-Za-z0-9_-]{43}$/
    );
  });

  it("refreshes an existing membership instead of replacing its capability", async () => {
    const memberToken = `armm1_${"D".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ memberToken })
    );
    mocks.rpc.mockImplementation(decodeThrough(view(3)));

    await joinAssignmentRoom({
      roomId: ROOM_ID,
      joinToken: JOIN_TOKEN,
      displayName: "Outro nome",
    });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "refresh_assignment_room_member",
    ]);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toBe(memberToken);
  });

  it("retains a minted member capability when lost-response recovery is offline", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new LedgerError("network"))
      .mockRejectedValueOnce(new LedgerError("network"));

    await expect(
      joinAssignmentRoom({ roomId: ROOM_ID, joinToken: JOIN_TOKEN, displayName: "Bia" })
    ).rejects.toMatchObject({ code: "network" });

    expect(getAssignmentRoomMemberToken(ROOM_ID)).toMatch(
      /^armm1_[A-Za-z0-9_-]{43}$/
    );
  });

  it("blocks a second local claim for the same item while allowing no replay", async () => {
    const pending = Promise.withResolvers<AssignmentRoomView>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const input = {
      roomId: ROOM_ID,
      itemId: ITEM_ID,
      participantId: PARTICIPANT_ID,
      expectedItemRevision: 1,
      ticks: 120_000,
    };

    const first = setAssignmentRoomClaim(input);
    await expect(setAssignmentRoomClaim(input)).rejects.toMatchObject({
      code: "item_unavailable",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    pending.resolve(view(2));
    await expect(first).resolves.toEqual(view(2));
    expect(
      useAssignmentRoomStore.getState().rooms[ROOM_ID].pendingItemIds
    ).toEqual([]);
  });

  it("refreshes once after a conflict and never replays the claim", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ memberToken: `armm1_${"C".repeat(43)}` })
    );
    mocks.rpc
      .mockRejectedValueOnce(new LedgerError("stale_version"))
      .mockImplementationOnce(decodeThrough(view(5)));

    await expect(
      setAssignmentRoomClaim({
        roomId: ROOM_ID,
        itemId: ITEM_ID,
        participantId: PARTICIPANT_ID,
        expectedItemRevision: 1,
        ticks: 120_000,
      })
    ).rejects.toMatchObject({ code: "stale_version" });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "set_assignment_room_claim",
      "get_assignment_room",
    ]);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].view?.room.revision).toBe(5);
  });

  it("drops a mutation response after the auth generation changes", async () => {
    const pending = Promise.withResolvers<AssignmentRoomView>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const mutation = setAssignmentRoomClaim({
      roomId: ROOM_ID,
      itemId: ITEM_ID,
      participantId: PARTICIPANT_ID,
      expectedItemRevision: 1,
      ticks: 120_000,
    });
    mocks.authGeneration = 2;
    resetAssignmentRoomRuntime();
    pending.resolve(view(2));

    await expect(mutation).resolves.toEqual(view(2));
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID]?.view).toBeUndefined();
  });

  it("clears room credentials while retaining cancelled state", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: JOIN_TOKEN })
    );
    useAssignmentRoomStore.getState().install(view(2));
    mocks.rpc.mockImplementation(decodeThrough(view(3, "cancelled")));

    await cancelAssignmentRoom({ roomId: ROOM_ID, expectedRevision: 2 });

    expect(localStorage.getItem(`dividimos.assignment-room.${ROOM_ID}`)).toBeNull();
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].view?.room.status).toBe(
      "cancelled"
    );
  });

  it("installs finalization and refreshes the signed-in group exactly once", async () => {
    const finalized = {
      room: view(6),
      ack: {
        groupId: "group-1",
        expenseId: "expense-1",
        versionNo: 1,
        ledgerVersion: 4,
        eventId: 8,
      },
    };
    mocks.rpc.mockImplementation(decodeThrough(finalized));
    const memberToken = `armm1_${"E".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: JOIN_TOKEN, memberToken })
    );

    await finalizeAssignmentRoom({
      roomId: ROOM_ID,
      expectedRevision: 5,
      payload: {
        items: [],
        participants: [],
        shares: [],
        payers: [],
        itemAssignments: null,
        splitMethod: "fixed",
      },
    });

    expect(mocks.refreshGroup).toHaveBeenCalledOnce();
    expect(mocks.refreshGroup).toHaveBeenCalledWith("group-1");
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].view?.room.revision).toBe(6);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toBe(memberToken);
    expect(
      localStorage.getItem(`dividimos.assignment-room.${ROOM_ID}`)
    ).not.toContain(JOIN_TOKEN);
  });
});
