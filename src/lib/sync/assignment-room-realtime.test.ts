import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { LedgerError } from "./errors";

class FakeChannel {
  readonly handlers = new Map<string, (message: { payload: unknown }) => void>();
  statusHandler: ((status: string) => void) | null = null;

  on(_type: string, filter: { event: string }, handler: (message: { payload: unknown }) => void) {
    this.handlers.set(filter.event, handler);
    return this;
  }

  subscribe(handler: (status: string) => void) {
    this.statusHandler = handler;
    return this;
  }

  emit(event: string, payload: unknown) {
    this.handlers.get(event)?.({ payload });
  }

  status(status: string) {
    this.statusHandler?.(status);
  }
}

const mocks = vi.hoisted(() => ({
  memberToken: null as string | null,
  topic: null as string | null,
  refresh: vi.fn(),
  refreshMember: vi.fn(),
  clearAccess: vi.fn(),
  channels: [] as FakeChannel[],
  removeChannel: vi.fn(),
}));

vi.mock("./assignment-rooms", () => ({
  clearAssignmentRoomAccess: mocks.clearAccess,
  getAssignmentRoomMemberToken: () => mocks.memberToken,
  getAssignmentRoomTopic: () => mocks.topic,
  refreshAssignmentRoom: mocks.refresh,
  refreshAssignmentRoomMember: mocks.refreshMember,
}));
vi.mock("./client", () => ({
  getSupabase: () => ({
    channel: () => {
      const channel = new FakeChannel();
      mocks.channels.push(channel);
      return channel;
    },
    removeChannel: mocks.removeChannel,
  }),
}));

import {
  startAssignmentRoomRealtime,
  stopAllAssignmentRoomRealtime,
} from "./assignment-room-realtime";
import { useAssignmentRoomStore } from "@/stores/assignment-room-store";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";

function view(revision: number): AssignmentRoomView {
  return {
    role: "participant",
    room: {
      id: ROOM_ID,
      revision,
      status: "open",
      title: "Almoço",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      totalCents: 100,
      selfParticipantId: "participant-1",
      items: [],
      participants: [],
      claims: [],
      topic: mocks.topic,
      currentBill: null,
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function successfulRefresh(revision: number) {
  return async () => {
    useAssignmentRoomStore.getState().install(view(revision));
    return view(revision);
  };
}

describe("assignment room realtime sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.memberToken = null;
    mocks.topic = null;
    mocks.refresh.mockReset();
    mocks.refreshMember.mockReset();
    mocks.clearAccess.mockReset();
    mocks.channels.length = 0;
    mocks.removeChannel.mockReset();
    useAssignmentRoomStore.getState().reset();
  });

  it("hydrates a guest capability once before subscribing", async () => {
    mocks.memberToken = `armm1_${"A".repeat(43)}`;
    mocks.topic = `assignment:${ROOM_ID}:${"B".repeat(43)}`;
    mocks.refreshMember.mockImplementation(successfulRefresh(2));
    mocks.refresh.mockImplementation(successfulRefresh(2));

    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();

    expect(mocks.refreshMember).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.channels).toHaveLength(1);
    mocks.channels[0].status("SUBSCRIBED");
    await settle();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].connected).toBe(true);
    stop();
  });

  it("hydrates an authenticated host without a member capability", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"C".repeat(43)}`;
    mocks.refresh.mockImplementation(successfulRefresh(1));

    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();

    expect(mocks.refreshMember).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.channels).toHaveLength(1);
    stop();
  });

  it("coalesces a burst into one active and one pending snapshot read", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"D".repeat(43)}`;
    mocks.refresh.mockImplementationOnce(successfulRefresh(1));
    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();
    const active = Promise.withResolvers<AssignmentRoomView>();
    mocks.refresh.mockReturnValueOnce(active.promise).mockImplementationOnce(successfulRefresh(5));

    mocks.channels[0].emit("assignment", { revision: 5 });
    mocks.channels[0].emit("assignment", { revision: 6 });
    mocks.channels[0].emit("assignment", { revision: 7 });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    active.resolve(view(4));
    await settle();
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("recovers a channel error through a snapshot and successor topic", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"E".repeat(43)}`;
    mocks.refresh.mockImplementationOnce(successfulRefresh(1));
    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();
    const firstChannel = mocks.channels[0];
    mocks.refresh.mockImplementationOnce(async () => {
      mocks.topic = `assignment:${ROOM_ID}:${"F".repeat(43)}`;
      return successfulRefresh(2)();
    });

    firstChannel.status("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(250);
    await settle();

    expect(mocks.removeChannel).toHaveBeenCalledWith(firstChannel);
    expect(mocks.channels).toHaveLength(2);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].connected).toBe(true);
    stop();
  });

  it("backs off repeated channel failures until a subscription succeeds", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"J".repeat(43)}`;
    mocks.refresh.mockImplementation(successfulRefresh(1));
    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();

    mocks.channels[0].status("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(249);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    mocks.channels[1].status("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("clears a denied board and stops retrying", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"G".repeat(43)}`;
    mocks.refresh.mockRejectedValue(new LedgerError("invalid_token"));

    startAssignmentRoomRealtime(ROOM_ID);
    await settle();
    await vi.runAllTimersAsync();

    expect(mocks.clearAccess).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes on visible focus and disposal blocks late subscription", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"H".repeat(43)}`;
    mocks.refresh.mockImplementation(successfulRefresh(1));
    const stop = startAssignmentRoomRealtime(ROOM_ID);
    await settle();
    const beforeFocus = mocks.refresh.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.refresh).toHaveBeenCalledTimes(beforeFocus + 1);

    const pending = Promise.withResolvers<AssignmentRoomView>();
    mocks.refresh.mockReturnValueOnce(pending.promise);
    window.dispatchEvent(new Event("online"));
    stop();
    pending.resolve(view(3));
    await settle();
    expect(mocks.channels).toHaveLength(1);
  });

  it("stops every active room subscription on account reset", async () => {
    mocks.topic = `assignment:${ROOM_ID}:${"I".repeat(43)}`;
    mocks.refresh.mockImplementation(successfulRefresh(1));
    startAssignmentRoomRealtime(ROOM_ID);
    await settle();

    stopAllAssignmentRoomRealtime();

    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channels[0]);
    expect(useAssignmentRoomStore.getState().rooms[ROOM_ID].connected).toBe(false);
  });
});
