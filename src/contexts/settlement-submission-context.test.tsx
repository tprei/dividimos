import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, beforeEach, expect, it, vi } from "vitest";
import type * as SettlementActionsModule from "@/lib/supabase/settlement-actions";
import type { RecordSettlementsResult } from "@/types";


const mocks = vi.hoisted(() => ({
  getSettlementOperation: vi.fn(),
  notifySettlementRecorded: vi.fn(),
  recordSettlements: vi.fn(),
  user: { id: "11111111-1111-1111-1111-111111111111" },
}));

vi.mock("@/lib/supabase/settlement-actions", async () => {
  const actual = await vi.importActual<typeof SettlementActionsModule>(
    "@/lib/supabase/settlement-actions",
  );
  return {
    ...actual,
    getSettlementOperation: mocks.getSettlementOperation,
    recordSettlements: mocks.recordSettlements,
  };
});

vi.mock("@/lib/push/push-notify", () => ({
  notifySettlementRecorded: mocks.notifySettlementRecorded,
}));

vi.mock("@/contexts/user-context", () => ({
  useUser: () => mocks.user,
}));

import {
  SettlementDatabaseRejectionError,
  SettlementOperationCorruptError,
  SettlementOutcomeUnknownError,
} from "@/lib/supabase/settlement-actions";
import {
  SettlementStorageCorruptionError,
  SettlementSubmissionProvider,
  settlementEdgeKey,
  useSettlementSubmission,
} from "./settlement-submission-context";

const operationId = "22222222-2222-2222-2222-222222222222";
const groupId = "33333333-3333-3333-3333-333333333333";
const debtorId = "44444444-4444-4444-4444-444444444444";
const creditorId = "55555555-5555-5555-5555-555555555555";
const settlementId = "66666666-6666-6666-6666-666666666666";
const allocation = {
  groupId,
  fromUserId: debtorId,
  toUserId: creditorId,
  amountCents: 5000,
};
const freshResult: RecordSettlementsResult = {
  operationId,
  settlements: [
    {
      id: settlementId,
      groupId,
      fromUserId: debtorId,
      toUserId: creditorId,
      amountCents: 5000,
      status: "confirmed",
      createdAt: "2026-07-16T00:00:00Z",
      confirmedAt: "2026-07-16T00:00:00Z",
    },
  ],
  replayed: false,
};

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createTestLockManager() {
  const tails = new Map<string, Promise<void>>();
  return {
    request<T>(
      name: string,
      _options: LockOptions,
      callback: () => Promise<T>,
    ): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(name, tail);
      return previous.then(async () => {
        try {
          return await callback();
        } finally {
          release();
          if (tails.get(name) === tail) {
            tails.delete(name);
          }
        }
      });
    },
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <SettlementSubmissionProvider>{children}</SettlementSubmissionProvider>;
}

describe("SettlementSubmissionProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    mocks.user = { id: "11111111-1111-1111-1111-111111111111" };
    vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: createTestLockManager(),
    });
  });

  it("starts ready only after restoring an empty account slot", () => {
    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    expect(result.current.phase).toBe("idle");
    expect(result.current.ready).toBe(true);
    expect(result.current.reservedEdgeKeys).toEqual(new Set());
  });

  it("persists one immutable request before the first RPC and blocks a synchronous second submit", async () => {
    const deferred = createDeferred<RecordSettlementsResult>();
    let storedAtRpc = "";
    mocks.recordSettlements.mockImplementation(() => {
      storedAtRpc = window.localStorage.getItem(
        "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      ) ?? "";
      return deferred.promise;
    });
    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    let first: Promise<RecordSettlementsResult>;
    let second: Promise<RecordSettlementsResult>;
    act(() => {
      first = result.current.submit([allocation]);
      second = result.current.submit([allocation]);
    });

    await expect(second!).rejects.toThrow("already active");
    await waitFor(() => expect(result.current.phase).toBe("submitting"));
    expect(result.current.reservedEdgeKeys.has(settlementEdgeKey(allocation))).toBe(true);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storedAtRpc)).toEqual({ operationId, allocations: [allocation] });

    await act(async () => {
      deferred.resolve(freshResult);
      await first!;
    });

    expect(result.current.phase).toBe("committed");
    expect(result.current.result).toEqual(freshResult);
    expect(mocks.notifySettlementRecorded).toHaveBeenCalledWith(
      groupId,
      debtorId,
      creditorId,
      5000,
    );
  });

  it("retains persisted reservations after an unknown outcome", async () => {
    mocks.recordSettlements.mockRejectedValue(new SettlementOutcomeUnknownError());
    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    await act(async () => {
      await expect(result.current.submit([allocation])).rejects.toBeInstanceOf(
        SettlementOutcomeUnknownError,
      );
    });

    expect(result.current.phase).toBe("unresolved");
    expect(result.current.request?.operationId).toBe(operationId);
    expect(result.current.reservedEdgeKeys.has(settlementEdgeKey(allocation))).toBe(true);
    expect(window.localStorage.getItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
    )).not.toBeNull();
    expect(mocks.notifySettlementRecorded).not.toHaveBeenCalled();
  });

  it("fails closed without an RPC when persistence fails", async () => {
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => {
          throw new DOMException("quota exceeded");
        },
      },
    });

    try {
      const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

      await act(async () => {
        await expect(result.current.submit([allocation])).rejects.toThrow(
          "could not be persisted",
        );
      });

      expect(result.current.phase).toBe("storage_error");
      expect(result.current.request).toBeNull();
      expect(mocks.recordSettlements).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it("reconciles a stored zero-row operation with the exact operation ID and clears restoration", async () => {
    window.localStorage.setItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      JSON.stringify({ operationId, allocations: [allocation] }),
    );
    mocks.getSettlementOperation.mockResolvedValue(null);
    mocks.recordSettlements.mockResolvedValue(freshResult);

    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    await waitFor(() => expect(mocks.recordSettlements).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    expect(mocks.getSettlementOperation).toHaveBeenCalledWith(operationId);
    expect(mocks.recordSettlements).toHaveBeenCalledWith({ operationId, allocations: [allocation] });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    expect(result.current.request).toBeNull();
    expect(window.localStorage.getItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
    )).toBeNull();
  });

  it("clears a restored committed operation without replaying notifications", async () => {
    window.localStorage.setItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      JSON.stringify({ operationId, allocations: [allocation] }),
    );
    mocks.getSettlementOperation.mockResolvedValue(freshResult.settlements);

    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    await waitFor(() => expect(mocks.getSettlementOperation).toHaveBeenCalledWith(operationId));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    expect(result.current.request).toBeNull();
    expect(window.localStorage.getItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
    )).toBeNull();
    expect(mocks.notifySettlementRecorded).not.toHaveBeenCalled();
  });

  it("clears a restored rejected operation so a new submission can start", async () => {
    window.localStorage.setItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      JSON.stringify({ operationId, allocations: [allocation] }),
    );
    mocks.getSettlementOperation.mockResolvedValue(null);
    mocks.recordSettlements
      .mockRejectedValueOnce(
        new SettlementDatabaseRejectionError("database_rejection", "PST05", "rejected"),
      )
      .mockResolvedValueOnce(freshResult);

    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      await expect(result.current.submit([allocation])).resolves.toEqual(freshResult);
    });
  });

  it("fails closed without a cross-tab lock", async () => {
    const locks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });

    try {
      const { result } = renderHook(() => useSettlementSubmission(), { wrapper });

      await act(async () => {
        await expect(result.current.submit([allocation])).rejects.toThrow(
          "coordination is unavailable",
        );
      });

      expect(result.current.phase).toBe("storage_error");
      expect(mocks.recordSettlements).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: locks,
      });
    }
  });

  it("serializes cross-tab retries through the persisted request", async () => {
    const deferred = createDeferred<RecordSettlementsResult>();
    mocks.recordSettlements
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(freshResult);
    mocks.getSettlementOperation.mockResolvedValue(null);
    const first = renderHook(() => useSettlementSubmission(), { wrapper });
    const second = renderHook(() => useSettlementSubmission(), { wrapper });

    let firstSubmission: Promise<RecordSettlementsResult>;
    let secondSubmission: Promise<RecordSettlementsResult>;
    act(() => {
      firstSubmission = first.result.current.submit([allocation]);
      secondSubmission = second.result.current.submit([allocation]);
    });

    await waitFor(() => expect(mocks.recordSettlements).toHaveBeenCalledTimes(1));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);

    deferred.reject(new SettlementOutcomeUnknownError());
    await act(async () => {
      await expect(firstSubmission!).rejects.toBeInstanceOf(SettlementOutcomeUnknownError);
      await expect(secondSubmission!).resolves.toEqual(freshResult);
    });

    expect(mocks.recordSettlements).toHaveBeenNthCalledWith(
      1,
      { operationId, allocations: [allocation] },
    );
    expect(mocks.recordSettlements).toHaveBeenNthCalledWith(
      2,
      { operationId, allocations: [allocation] },
    );
    expect(second.result.current.phase).toBe("committed");
  });

  it("reconciles a request reserved by another tab", async () => {
    const { result } = renderHook(() => useSettlementSubmission(), { wrapper });
    const key = "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111";
    const serialized = JSON.stringify({ operationId, allocations: [allocation] });
    mocks.getSettlementOperation.mockResolvedValue(freshResult.settlements);
    window.localStorage.setItem(key, serialized);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue: serialized,
        storageArea: window.localStorage,
      }));
    });

    await waitFor(() => expect(mocks.getSettlementOperation).toHaveBeenCalledWith(operationId));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(mocks.recordSettlements).not.toHaveBeenCalled();
  });

  it("blocks unreadable storage and operation corruption without replacement", async () => {
    window.localStorage.setItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      "not-json",
    );
    const malformed = renderHook(() => useSettlementSubmission(), { wrapper });

    expect(malformed.result.current.phase).toBe("blocked");
    expect(malformed.result.current.error).toBeInstanceOf(SettlementStorageCorruptionError);
    malformed.unmount();

    window.localStorage.setItem(
      "dividimos:settlement-operation:11111111-1111-1111-1111-111111111111",
      JSON.stringify({ operationId, allocations: [allocation] }),
    );
    mocks.getSettlementOperation.mockRejectedValue(new SettlementOperationCorruptError("corrupt"));
    const corrupt = renderHook(() => useSettlementSubmission(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(corrupt.result.current.phase).toBe("blocked");
    expect(corrupt.result.current.request?.operationId).toBe(operationId);
  });

  it("ignores a stale account response without notifications", async () => {
    const deferred = createDeferred<RecordSettlementsResult>();
    mocks.recordSettlements.mockReturnValue(deferred.promise);
    const { result, rerender } = renderHook(() => useSettlementSubmission(), { wrapper });

    let submission: Promise<RecordSettlementsResult>;
    act(() => {
      submission = result.current.submit([allocation]);
    });

    mocks.user = { id: "88888888-8888-8888-8888-888888888888" };
    rerender();
    await act(async () => {
      deferred.resolve(freshResult);
      await expect(submission!).rejects.toBeInstanceOf(SettlementOutcomeUnknownError);
    });

    expect(result.current.phase).toBe("idle");
    expect(mocks.notifySettlementRecorded).not.toHaveBeenCalled();
  });
});
