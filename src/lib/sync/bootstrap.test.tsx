import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bootstrap } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "./errors";
import { rpc } from "./client";
import { advanceBlockListEpoch, attachVisibilityRefresh, catchUpBootstrap, runBootstrap } from "./bootstrap";
import { readUserBlocks } from "./refresh";

const authState = vi.hoisted(() => ({ generation: 0 }));
vi.mock("./client", () => ({
  rpc: vi.fn(),
  getAuthGeneration: () => authState.generation,
  advanceAuthGeneration: () => {
    authState.generation += 1;
    return authState.generation;
  },
}));
vi.mock("./refresh", () => ({
  refreshHostedAssignmentRooms: vi.fn(async () => {}),
  readUserBlocks: vi.fn(async () => []),
}));

const rpcMock = vi.mocked(rpc);
const bootstrapResponse: Bootstrap = {
  me: {
    id: "user-1",
    handle: "user1",
    name: "User One",
    avatarUrl: null,
    isBot: false,
    email: "user1@example.com",
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: {
      expenses: true,
      settlements: true,
      nudges: true,
    },
  },
  groups: [],
  serverTime: "2026-09-26T12:00:00.000Z",
};

function becomeVisible(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("attachVisibilityRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.generation = 0;
    useAppStore.setState({ lastBootstrapAt: null });
  });

  it("hands a failed refresh to the caller instead of leaking the rejection", async () => {
    const failure = new LedgerError("invalid_wire");
    rpcMock.mockRejectedValue(failure);
    const onError = vi.fn();

    const stop = attachVisibilityRefresh(onError);
    becomeVisible();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));

    stop();
  });

  it("stops refreshing once detached", () => {
    rpcMock.mockRejectedValue(new LedgerError("invalid_wire"));

    attachVisibilityRefresh(vi.fn())();
    becomeVisible();

    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("catchUpBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.generation = 0;
    useAppStore.setState({ lastBootstrapAt: null });
  });

  it("starts one bootstrap read when none is already in flight", async () => {
    rpcMock.mockResolvedValueOnce(bootstrapResponse as never);

    await catchUpBootstrap();

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "bootstrap_overview_v2",
      {},
      expect.any(Function),
    );
  });

  it("queues one fresh read for a membership broadcast during a bootstrap", async () => {
    const first = Promise.withResolvers<Bootstrap>();
    const followUp = Promise.withResolvers<Bootstrap>();
    rpcMock
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(followUp.promise as never);

    const initialRead = runBootstrap();
    const firstCatchUp = catchUpBootstrap();
    const concurrentCatchUp = catchUpBootstrap();

    expect(firstCatchUp).toBe(concurrentCatchUp);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    first.resolve(bootstrapResponse);
    await vi.waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
    followUp.resolve(bootstrapResponse);
    await Promise.all([initialRead, firstCatchUp]);

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("starts another read when called while the follow-up read is running", async () => {
    const initialRead = Promise.withResolvers<Bootstrap>();
    const followUpRead = Promise.withResolvers<Bootstrap>();
    rpcMock
      .mockReturnValueOnce(initialRead.promise as never)
      .mockReturnValueOnce(followUpRead.promise as never)
      .mockResolvedValueOnce(bootstrapResponse as never);

    void runBootstrap();
    const queued = catchUpBootstrap();
    initialRead.resolve(bootstrapResponse);
    await vi.waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));

    const late = catchUpBootstrap();
    expect(late).not.toBe(queued);

    followUpRead.resolve(bootstrapResponse);
    await Promise.all([queued, late]);

    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a queued read after the auth generation changes", async () => {
    const first = Promise.withResolvers<Bootstrap>();
    rpcMock.mockReturnValueOnce(first.promise as never);

    const initialRead = runBootstrap();
    const catchUp = catchUpBootstrap();
    authState.generation += 1;
    first.resolve(bootstrapResponse);
    await Promise.all([initialRead, catchUp]);

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("runBootstrap and the block list", () => {
  it("never lets a bootstrap that started before a block overwrite the acknowledged list", async () => {
    useAppStore.getState().reset();
    const blocked = { id: "u-x", handle: "x", name: "X", avatarUrl: null, isBot: false };
    const overview = Promise.withResolvers<unknown>();
    const staleList = Promise.withResolvers<unknown>();
    rpcMock.mockReturnValueOnce(overview.promise as never);
    vi.mocked(readUserBlocks).mockReturnValueOnce(staleList.promise as never);

    const stale = runBootstrap();
    advanceBlockListEpoch();
    useAppStore.getState().applyUserBlocks([blocked]);
    overview.resolve({
      me: {
        id: "u-me",
        handle: "me",
        name: "Me",
        avatarUrl: null,
        isBot: false,
        email: "me@example.com",
        pixKeyType: null,
        pixKeyHint: null,
        onboarded: true,
        notificationPreferences: { expenses: true, settlements: true, nudges: true },
      },
      groups: [],
      serverTime: "2026-09-27T10:00:00.000Z",
    });
    staleList.resolve([]);
    await stale;

    expect(useAppStore.getState().blockedUsers).toEqual([blocked]);
  });

  it("commits the overview and keeps the cached list when the block list read fails", async () => {
    useAppStore.getState().reset();
    const blocked = { id: "u-x", handle: "x", name: "X", avatarUrl: null, isBot: false };
    useAppStore.getState().applyUserBlocks([blocked]);
    rpcMock.mockResolvedValueOnce(bootstrapResponse as never);
    vi.mocked(readUserBlocks).mockRejectedValueOnce(new LedgerError("unknown"));

    await runBootstrap();

    expect(useAppStore.getState().me?.id).toBe(bootstrapResponse.me.id);
    expect(useAppStore.getState().bootstrapStatus).toBe("ready");
    expect(useAppStore.getState().blockedUsers).toEqual([blocked]);
  });
});
