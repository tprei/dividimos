import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenGroupRoom } from "./use-open-group-room";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const enterRoomMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sync/assignment-rooms", () => ({
  enterGroupAssignmentRoom: enterRoomMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useOpenGroupRoom", () => {
  it("enters a non-host room with the room's own groupId then routes to it", async () => {
    enterRoomMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenGroupRoom("user-1"));

    await act(async () => {
      await result.current.openRoom({
        id: "room-1",
        groupId: "group-9",
        host: { id: "user-2" },
      });
    });

    expect(enterRoomMock).toHaveBeenCalledWith({ groupId: "group-9", roomId: "room-1" });
    expect(routerMock.push).toHaveBeenCalledWith("/room/room-1");
  });

  it("routes a host straight to the room without entering", async () => {
    const { result } = renderHook(() => useOpenGroupRoom("user-1"));

    await act(async () => {
      await result.current.openRoom({
        id: "room-1",
        groupId: "group-9",
        host: { id: "user-1" },
      });
    });

    expect(enterRoomMock).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/room/room-1");
  });
});
