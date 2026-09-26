import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView, OpenAssignmentRoom } from "@/types/assignment-room";
import { LedgerError } from "./errors";

const mocks = vi.hoisted(() => ({
  authGeneration: 1,
  rpc: vi.fn(),
  refreshGroup: vi.fn(() => Promise.resolve()),
  notify: vi.fn(),
}));

vi.mock("./client", () => ({
  getAuthGeneration: () => mocks.authGeneration,
  rpc: mocks.rpc,
}));
vi.mock("./refresh", () => ({ refreshGroup: mocks.refreshGroup }));
vi.mock("./mutations", () => ({ notify: mocks.notify }));

import {
  cancelAssignmentRoom,
  claimAssignmentRoomGuest,
  clearAssignmentRoomAccess,
  createAssignmentRoom,
  enterGroupAssignmentRoom,
  finalizeAssignmentRoom,
  getAssignmentRoomJoinToken,
  getAssignmentRoomMemberToken,
  joinAssignmentRoom,
  refreshAssignmentRoomCompletion,
  resetAssignmentRoomRuntime,
  rotateAssignmentRoomJoin,
  setAssignmentRoomClaim,
  type CreateAssignmentRoomInput,
} from "./assignment-rooms";

import { useAssignmentRoomStore } from "@/stores/assignment-room-store";
import { useAppStore } from "@/stores/app-store";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000003";
const JOIN_TOKEN = `armj1_${"A".repeat(43)}`;
const OTHER_ROOM_ID = "00000000-0000-4000-8000-000000000009";

function view(revision: number, status: "open" | "cancelled" = "open"): AssignmentRoomView {
  return {
    role: "participant",
    room: {
      id: ROOM_ID,
      revision,
      title: "Almoço",
      status,
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

function createInput(
  groupTarget: CreateAssignmentRoomInput["groupTarget"],
): CreateAssignmentRoomInput {
  return {
    groupTarget,
    header: {
      title: "Almoço",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
    },
    items: [],
    participants: [],
  };
}

describe("assignment room sync", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.authGeneration = 1;

    mocks.rpc.mockReset();
    mocks.refreshGroup.mockReset();
    mocks.notify.mockReset();
    useAppStore.getState().reset();
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

  it("persists the replacement host invitation before rotating it", async () => {
    const oldJoinToken = `armj1_${"C".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: oldJoinToken }),
    );
    mocks.rpc.mockImplementation(async (_name, args, decode) => {
      expect(args.p_join_token).toBe(getAssignmentRoomJoinToken(ROOM_ID));
      expect(args.p_join_token).not.toBe(oldJoinToken);
      return (decode(view(2)) as { value: AssignmentRoomView }).value;
    });

    await rotateAssignmentRoomJoin(ROOM_ID);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "rotate_assignment_room_join",
      expect.objectContaining({ p_room_id: ROOM_ID }),
      expect.any(Function),
    );
    expect(getAssignmentRoomJoinToken(ROOM_ID)).toMatch(/^armj1_[A-Za-z0-9_-]{43}$/);
  });

  it("restores the prior invitation when rotation is rejected", async () => {
    const oldJoinToken = `armj1_${"C".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: oldJoinToken }),
    );
    mocks.rpc.mockRejectedValueOnce(new LedgerError("not_a_member"));

    await expect(rotateAssignmentRoomJoin(ROOM_ID)).rejects.toMatchObject({ code: "not_a_member" });

    expect(getAssignmentRoomJoinToken(ROOM_ID)).toBe(oldJoinToken);
  });
  it("reads finalized completion with the stored member capability", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ memberToken: `armm1_${"F".repeat(43)}` }),
    );
    const completion = {
      roomId: ROOM_ID,
      bill: {
        status: "active",
        versionNo: 1,
        title: "Almoço",
        occurredOn: "2026-09-19",
        items: [],
        itemAssignments: null,
        participants: [],
        shares: [],
        payers: [],
        totalCents: 0,
        serviceFeeBasisPoints: 0,
        fixedFeeCents: 0,
      },
      selfParticipantIndex: null,
      action: { kind: "sign_in" },
    } as const;
    mocks.rpc.mockImplementation(async (name, args, decode) => {
      expect(name).toBe("get_assignment_room_completion");
      expect(args).toEqual({
        p_room_id: ROOM_ID,
        p_member_token: `armm1_${"F".repeat(43)}`,
      });
      return decodeThrough(completion)(name, args, decode);
    });

    await expect(refreshAssignmentRoomCompletion(ROOM_ID)).resolves.toEqual(completion);
  });

  it("refreshes room and group state after claiming a room guest", async () => {
    const memberToken = `armm1_${"G".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ memberToken }),
    );
    const ack = {
      groupId: "00000000-0000-4000-8000-000000000004",
      expenseId: "00000000-0000-4000-8000-000000000005",
      ledgerVersion: 4,
      eventId: 8,
    };
    mocks.rpc
      .mockImplementationOnce(async (name, args, decode) => {
        expect(name).toBe("claim_assignment_room_guest");
        expect(args).toEqual({ p_room_id: ROOM_ID, p_member_token: memberToken });
        return decodeThrough(ack)(name, args, decode);
      })
      .mockImplementationOnce(decodeThrough(view(3)));

    await expect(claimAssignmentRoomGuest(ROOM_ID)).resolves.toEqual(ack);
    expect(mocks.refreshGroup).toHaveBeenCalledWith(ack.groupId);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_assignment_room_guest",
      "get_assignment_room",
    ]);
  });

  it("reuses a stored member token by refreshing instead of re-entering", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ memberToken: `armm1_${"H".repeat(43)}` }),
    );
    mocks.rpc.mockImplementation(decodeThrough(view(4)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "refresh_assignment_room_member",
    ]);
    expect(mocks.refreshGroup).not.toHaveBeenCalled();
  });

  it("falls through to one fresh enter when the stored token was rotated elsewhere", async () => {
    const rotated = `armm1_${"I".repeat(43)}`;
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: JOIN_TOKEN, memberToken: rotated }),
    );
    mocks.rpc
      .mockRejectedValueOnce(new LedgerError("invalid_token"))
      .mockImplementationOnce(decodeThrough(view(2)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "refresh_assignment_room_member",
      "enter_group_assignment_room",
    ]);
    expect(mocks.rpc.mock.calls[1]?.[1]).toEqual({
      p_room_id: ROOM_ID,
      p_member_token: expect.stringMatching(/^armm1_[A-Za-z0-9_-]{43}$/),
    });
    expect(getAssignmentRoomMemberToken(ROOM_ID)).not.toBe(rotated);
    expect(getAssignmentRoomJoinToken(ROOM_ID)).toBe(JOIN_TOKEN);
  });

  it("refreshes the group when the room state refuses the entry", async () => {
    mocks.rpc.mockRejectedValueOnce(new LedgerError("room_closed"));

    await expect(
      enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID })
    ).rejects.toMatchObject({ code: "room_closed" });

    expect(mocks.refreshGroup).toHaveBeenCalledOnce();
    expect(mocks.refreshGroup).toHaveBeenCalledWith("group-1");
    expect(localStorage.getItem(`dividimos.assignment-room.${ROOM_ID}`)).toBeNull();
  });

  it("refreshes the group when a fresh enter is denied for a removed participant", async () => {
    mocks.rpc.mockRejectedValueOnce(new LedgerError("invalid_token"));

    await expect(
      enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID })
    ).rejects.toMatchObject({ code: "invalid_token" });

    expect(mocks.refreshGroup).toHaveBeenCalledOnce();
    expect(mocks.refreshGroup).toHaveBeenCalledWith("group-1");
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toBeNull();
  });

  it("keeps the stored join token when the room refuses the entry", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: JOIN_TOKEN }),
    );
    mocks.rpc.mockRejectedValueOnce(new LedgerError("room_closed"));

    await expect(
      enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID })
    ).rejects.toMatchObject({ code: "room_closed" });

    expect(getAssignmentRoomJoinToken(ROOM_ID)).toBe(JOIN_TOKEN);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toBeNull();
  });

  it("keeps the stored join token when entering succeeds", async () => {
    localStorage.setItem(
      `dividimos.assignment-room.${ROOM_ID}`,
      JSON.stringify({ joinToken: JOIN_TOKEN }),
    );
    mocks.rpc.mockImplementationOnce(decodeThrough(view(2)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID });

    expect(getAssignmentRoomJoinToken(ROOM_ID)).toBe(JOIN_TOKEN);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toMatch(
      /^armm1_[A-Za-z0-9_-]{43}$/
    );
  });

  it("leaves an existing room-store entry untouched when entering succeeds", async () => {
    useAssignmentRoomStore.getState().install(view(2));
    mocks.rpc.mockImplementationOnce(decodeThrough(view(4)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID });

    expect(
      useAssignmentRoomStore.getState().rooms[ROOM_ID]?.view?.room.revision
    ).toBe(2);
  });

  it("creates no room-store entry when entering an untracked room", async () => {
    mocks.rpc.mockImplementationOnce(decodeThrough(view(2)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: OTHER_ROOM_ID });

    expect(useAssignmentRoomStore.getState().rooms[OTHER_ROOM_ID]).toBeUndefined();
  });

  it("leaves an existing room-store entry when the room refuses the entry", async () => {
    useAssignmentRoomStore.getState().install(view(2));
    mocks.rpc.mockRejectedValueOnce(new LedgerError("room_closed"));

    await expect(
      enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID })
    ).rejects.toMatchObject({ code: "room_closed" });

    expect(
      useAssignmentRoomStore.getState().rooms[ROOM_ID]?.view?.room.revision
    ).toBe(2);
  });

  it("recovers a lost enter response with the persisted member capability", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new LedgerError("network"))
      .mockImplementationOnce(decodeThrough(view(3)));

    await expect(
      enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID })
    ).resolves.toBeUndefined();

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "enter_group_assignment_room",
      "refresh_assignment_room_member",
    ]);
    expect(getAssignmentRoomMemberToken(ROOM_ID)).toMatch(
      /^armm1_[A-Za-z0-9_-]{43}$/
    );
  });

  it("marks the room joined in the cached group list after entering", async () => {
    const listed: OpenAssignmentRoom = {
      id: ROOM_ID,
      groupId: "group-1",
      status: "open",
      revision: 1,
      title: "Almoço",
      occurredOn: "2026-09-19",
      totalCents: 100,
      host: { id: "user-host", handle: "ana", name: "Ana", avatarUrl: null, isBot: false },
      createdAt: "2026-09-19T12:00:00.000Z",
      itemCount: 2,
      ownedItemCount: 0,
      claimers: [],
      expenseId: null,
      joined: false,
    };
    useAppStore.setState({ openAssignmentRoomsByGroupId: { "group-1": [listed] } });
    mocks.rpc.mockImplementationOnce(decodeThrough(view(2)));

    await enterGroupAssignmentRoom({ groupId: "group-1", roomId: ROOM_ID });

    expect(useAppStore.getState().openAssignmentRoomsByGroupId["group-1"]).toEqual([
      { ...listed, joined: true },
    ]);
  });

  it("announces a created existing-group room without gating the create", async () => {
    mocks.rpc
      .mockImplementationOnce(decodeThrough(view(2)))
      .mockImplementationOnce(decodeThrough({ eventId: 9 }));

    const created = await createAssignmentRoom(
      createInput({ kind: "existing", groupId: "group-1" }),
    );

    expect(created).toEqual(view(2));
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_assignment_room",
      "announce_assignment_room",
    ]);
    expect(mocks.rpc.mock.calls[1]?.[1]).toEqual({ p_room_id: ROOM_ID });
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(9));
  });

  it("keeps a create successful when the announcement fails", async () => {
    mocks.rpc
      .mockImplementationOnce(decodeThrough(view(2)))
      .mockRejectedValueOnce(new LedgerError("room_closed"));

    await expect(
      createAssignmentRoom(createInput({ kind: "existing", groupId: "group-1" }))
    ).resolves.toEqual(view(2));

    await vi.waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        "announce_assignment_room",
        { p_room_id: ROOM_ID },
        expect.any(Function),
      ),
    );
  });

  it("does not announce a room created outside an existing group", async () => {
    mocks.rpc.mockImplementationOnce(decodeThrough(view(2)));

    await createAssignmentRoom(createInput({ kind: "new", name: "Conta" }));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
