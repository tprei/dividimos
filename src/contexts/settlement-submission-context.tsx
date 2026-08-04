"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getSettlementOperation,
  recordSettlements,
  SettlementDatabaseRejectionError,
  SettlementOperationCorruptError,
  SettlementOutcomeUnknownError,
} from "@/lib/supabase/settlement-actions";
import { notifySettlementRecorded } from "@/lib/push/push-notify";
import { useUser } from "@/contexts/user-context";
import type {
  RecordSettlementsRequest,
  RecordSettlementsResult,
  Settlement,
  SettlementAllocation,
} from "@/types";

const STORAGE_PREFIX = "dividimos:settlement-operation:";
const LOCK_PREFIX = "dividimos:settlement-operation-lock:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SettlementSubmissionPhase =
  | "idle"
  | "restoring"
  | "storage_error"
  | "submitting"
  | "rejected"
  | "unresolved"
  | "reconciling"
  | "committed"
  | "blocked";

export class SettlementStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementStorageError";
  }
}

export class SettlementStorageCorruptionError extends SettlementStorageError {
  constructor(message: string) {
    super(message);
    this.name = "SettlementStorageCorruptionError";
  }
}

type SettlementSubmissionError =
  | SettlementDatabaseRejectionError
  | SettlementOutcomeUnknownError
  | SettlementStorageError;

type InactiveSubmissionState = {
  phase: "idle" | "restoring" | "storage_error";
  request: null;
  result: null;
  error: SettlementStorageError | null;
  reservedEdgeKeys: ReadonlySet<string>;
};

type ActiveSubmissionState = {
  phase: "submitting" | "unresolved" | "reconciling";
  request: RecordSettlementsRequest;
  result: null;
  error: SettlementOutcomeUnknownError | null;
  reservedEdgeKeys: ReadonlySet<string>;
};

type RejectedSubmissionState = {
  phase: "rejected";
  request: RecordSettlementsRequest;
  result: null;
  error: SettlementDatabaseRejectionError;
  reservedEdgeKeys: ReadonlySet<string>;
};

type CommittedSubmissionState = {
  phase: "committed";
  request: RecordSettlementsRequest;
  result: RecordSettlementsResult;
  error: null;
  reservedEdgeKeys: ReadonlySet<string>;
};

type BlockedSubmissionState = {
  phase: "blocked";
  request: RecordSettlementsRequest | null;
  result: null;
  error: SettlementOperationCorruptError | SettlementStorageCorruptionError;
  reservedEdgeKeys: ReadonlySet<string>;
};

export type SettlementSubmissionState =
  | InactiveSubmissionState
  | ActiveSubmissionState
  | RejectedSubmissionState
  | CommittedSubmissionState
  | BlockedSubmissionState;

export interface SettlementSubmissionView {
  phase: SettlementSubmissionPhase;
  request: RecordSettlementsRequest | null;
  result: RecordSettlementsResult | null;
  error: SettlementSubmissionError | null;
  reconcile(operationId: string): Promise<RecordSettlementsResult | null>;
  finish(operationId: string): void;
}

interface SettlementSubmissionContextValue extends SettlementSubmissionView {
  ready: boolean;
  reservedEdgeKeys: ReadonlySet<string>;
  submit(allocations: readonly SettlementAllocation[]): Promise<RecordSettlementsResult>;
}

const SettlementSubmissionContext =
  createContext<SettlementSubmissionContextValue | null>(null);

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}


function operationLockManager(): LockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    return null;
  }
  return navigator.locks ?? null;
}


async function withOperationLock<T>(
  userId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const locks = operationLockManager();
  if (!locks) {
    throw new SettlementStorageError("Settlement operation coordination is unavailable");
  }
  return locks.request(`${LOCK_PREFIX}${userId}`, { mode: "exclusive" }, callback);
}

export function settlementEdgeKey({
  groupId,
  fromUserId,
  toUserId,
}: Pick<SettlementAllocation, "groupId" | "fromUserId" | "toUserId">): string {
  return `${groupId}:${fromUserId}:${toUserId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const valueKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return (
    valueKeys.length === expectedKeys.length &&
    valueKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function freezeRequest(
  operationId: string,
  allocations: readonly SettlementAllocation[],
): RecordSettlementsRequest {
  const snapshot = allocations.map((allocation) =>
    Object.freeze({
      groupId: allocation.groupId,
      fromUserId: allocation.fromUserId,
      toUserId: allocation.toUserId,
      amountCents: allocation.amountCents,
    }),
  );
  const request: RecordSettlementsRequest = {
    operationId,
    allocations: Object.freeze(snapshot),
  };
  return Object.freeze(request);
}

function freezeResult(result: RecordSettlementsResult): RecordSettlementsResult {
  const settlements = result.settlements.map((settlement) => ({ ...settlement }));
  for (const settlement of settlements) {
    Object.freeze(settlement);
  }
  Object.freeze(settlements);
  const frozen: RecordSettlementsResult = {
    operationId: result.operationId,
    settlements,
    replayed: result.replayed,
  };
  return Object.freeze(frozen);
}

function parseStoredRequest(serialized: string): RecordSettlementsRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new SettlementStorageCorruptionError("Stored settlement operation is unreadable");
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, ["operationId", "allocations"])) {
    throw new SettlementStorageCorruptionError("Stored settlement operation has an invalid shape");
  }

  if (!isUuid(parsed.operationId) || !Array.isArray(parsed.allocations) || parsed.allocations.length === 0) {
    throw new SettlementStorageCorruptionError("Stored settlement operation is invalid");
  }

  const allocations: SettlementAllocation[] = [];
  const edges = new Set<string>();
  for (const value of parsed.allocations) {
    if (!isRecord(value) || !hasExactKeys(value, ["groupId", "fromUserId", "toUserId", "amountCents"])) {
      throw new SettlementStorageCorruptionError("Stored settlement allocation has an invalid shape");
    }
    if (
      !isUuid(value.groupId) ||
      !isUuid(value.fromUserId) ||
      !isUuid(value.toUserId) ||
      value.fromUserId === value.toUserId ||
      typeof value.amountCents !== "number" ||
      !Number.isSafeInteger(value.amountCents) ||
      value.amountCents <= 0
    ) {
      throw new SettlementStorageCorruptionError("Stored settlement allocation is invalid");
    }

    const allocation = {
      groupId: value.groupId,
      fromUserId: value.fromUserId,
      toUserId: value.toUserId,
      amountCents: value.amountCents,
    };
    const edge = settlementEdgeKey(allocation);
    if (edges.has(edge)) {
      throw new SettlementStorageCorruptionError("Stored settlement operation has duplicate directed edges");
    }
    edges.add(edge);
    allocations.push(allocation);
  }

  return freezeRequest(parsed.operationId, allocations);
}

function readStoredRequest(userId: string): RecordSettlementsRequest | null {
  let serialized: string | null;
  try {
    serialized = window.localStorage.getItem(storageKey(userId));
  } catch {
    throw new SettlementStorageCorruptionError("Stored settlement operation could not be read");
  }
  return serialized === null ? null : parseStoredRequest(serialized);
}

function persistRequest(userId: string, request: RecordSettlementsRequest): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(request));
  } catch {
    throw new SettlementStorageError("Settlement operation could not be persisted");
  }
}

function removeStoredRequest(userId: string): boolean {
  try {
    window.localStorage.removeItem(storageKey(userId));
    return true;
  } catch {
    return false;
  }
}

function requestsMatch(
  first: RecordSettlementsRequest,
  second: RecordSettlementsRequest,
): boolean {
  return first.operationId === second.operationId
    && first.allocations.length === second.allocations.length
    && first.allocations.every((allocation, index) => {
      const other = second.allocations[index];
      return allocation.groupId === other.groupId
        && allocation.fromUserId === other.fromUserId
        && allocation.toUserId === other.toUserId
        && allocation.amountCents === other.amountCents;
    });
}

function emptyState(
  phase: InactiveSubmissionState["phase"],
  error: SettlementStorageError | null = null,
): InactiveSubmissionState {
  return {
    phase,
    request: null,
    result: null,
    error,
    reservedEdgeKeys: new Set(),
  };
}

function reservationFor(request: RecordSettlementsRequest): ReadonlySet<string> {
  return new Set(request.allocations.map(settlementEdgeKey));
}

function activeState(
  phase: ActiveSubmissionState["phase"],
  request: RecordSettlementsRequest,
  error: SettlementOutcomeUnknownError | null = null,
): ActiveSubmissionState {
  return {
    phase,
    request,
    result: null,
    error,
    reservedEdgeKeys: reservationFor(request),
  };
}

function rejectedState(
  request: RecordSettlementsRequest,
  error: SettlementDatabaseRejectionError,
): RejectedSubmissionState {
  return {
    phase: "rejected",
    request,
    result: null,
    error,
    reservedEdgeKeys: new Set(),
  };
}

function blockedState(
  request: RecordSettlementsRequest | null,
  error: SettlementOperationCorruptError | SettlementStorageCorruptionError,
): BlockedSubmissionState {
  return {
    phase: "blocked",
    request,
    result: null,
    error,
    reservedEdgeKeys: request ? reservationFor(request) : new Set(),
  };
}

function committedState(
  request: RecordSettlementsRequest,
  result: RecordSettlementsResult,
): CommittedSubmissionState {
  return {
    phase: "committed",
    request,
    result,
    error: null,
    reservedEdgeKeys: reservationFor(request),
  };
}

export function SettlementSubmissionProvider({ children }: { children: React.ReactNode }) {
  const user = useUser();
  const userId = user?.id ?? null;
  const [state, setReactState] = useState<SettlementSubmissionState>(() => emptyState("restoring"));
  const stateRef = useRef(state);
  const userIdRef = useRef<string | null>(userId);
  const generationRef = useRef(0);
  const submitGuardRef = useRef(false);
  const reconcilePromiseRef = useRef<{
    operationId: string;
    promise: Promise<RecordSettlementsResult | null>;
  } | null>(null);

  const updateState = useCallback((next: SettlementSubmissionState) => {
    stateRef.current = next;
    setReactState(next);
  }, []);

  const isCurrent = useCallback((request: RecordSettlementsRequest, ownerId: string, generation: number) => {
    return (
      userIdRef.current === ownerId &&
      generationRef.current === generation &&
      stateRef.current.request?.operationId === request.operationId
    );
  }, []);

  const recordRequest = useCallback(async (
    request: RecordSettlementsRequest,
    ownerId: string,
    generation: number,
  ): Promise<RecordSettlementsResult> => {
    try {
      const result = freezeResult(await recordSettlements(request));
      if (!isCurrent(request, ownerId, generation)) {
        throw new SettlementOutcomeUnknownError();
      }

      removeStoredRequest(ownerId);
      updateState(committedState(request, result));
      if (!result.replayed) {
        for (const settlement of result.settlements) {
          void notifySettlementRecorded(settlement.id);
        }
      }
      return result;
    } catch (error) {
      if (!isCurrent(request, ownerId, generation)) {
        throw new SettlementOutcomeUnknownError();
      }

      if (error instanceof SettlementOperationCorruptError) {
        updateState(blockedState(request, error));
        throw error;
      }

      if (error instanceof SettlementDatabaseRejectionError) {
        if (!removeStoredRequest(ownerId)) {
          const storageError = new SettlementStorageCorruptionError(
            "Rejected settlement operation could not be cleared from storage",
          );
          updateState(blockedState(request, storageError));
          throw storageError;
        }
        updateState(rejectedState(request, error));
        throw error;
      }

      const unknown = error instanceof SettlementOutcomeUnknownError
        ? error
        : new SettlementOutcomeUnknownError();
      updateState(activeState("unresolved", request, unknown));
      throw unknown;
    }
  }, [isCurrent, updateState]);

  const reconcileStoredRequest = useCallback(async (
    request: RecordSettlementsRequest,
    ownerId: string,
    generation: number,
    canReplay: boolean,
  ): Promise<RecordSettlementsResult | null> => {
    if (!isCurrent(request, ownerId, generation)) {
      throw new SettlementOutcomeUnknownError();
    }

    updateState(activeState("reconciling", request));
    let settlements: Settlement[] | null;
    try {
      settlements = await getSettlementOperation(request.operationId);
    } catch (error) {
      if (!isCurrent(request, ownerId, generation)) {
        throw new SettlementOutcomeUnknownError();
      }

      if (error instanceof SettlementOperationCorruptError) {
        updateState(blockedState(request, error));
        throw error;
      }
      if (error instanceof SettlementDatabaseRejectionError) {
        if (!removeStoredRequest(ownerId)) {
          const storageError = new SettlementStorageCorruptionError(
            "Rejected settlement operation could not be cleared from storage",
          );
          updateState(blockedState(request, storageError));
          throw storageError;
        }
        updateState(rejectedState(request, error));
        throw error;
      }

      const unknown = error instanceof SettlementOutcomeUnknownError
        ? error
        : new SettlementOutcomeUnknownError();
      updateState(activeState("unresolved", request, unknown));
      throw unknown;
    }

    if (!isCurrent(request, ownerId, generation)) {
      throw new SettlementOutcomeUnknownError();
    }

    if (settlements) {
      const result = freezeResult({
        operationId: request.operationId,
        settlements,
        replayed: true,
      });
      removeStoredRequest(ownerId);
      updateState(committedState(request, result));
      return result;
    }

    if (!canReplay) {
      updateState(emptyState("idle"));
      return null;
    }

    updateState(activeState("submitting", request));
    return recordRequest(request, ownerId, generation);
  }, [isCurrent, recordRequest, updateState]);

  const reconcile = useCallback((operationId: string): Promise<RecordSettlementsResult | null> => {
    const initialRequest = stateRef.current.request;
    const ownerId = userIdRef.current;
    if (!initialRequest || !ownerId || initialRequest.operationId !== operationId) {
      return Promise.resolve(null);
    }

    const inFlight = reconcilePromiseRef.current;
    if (inFlight?.operationId === operationId) {
      return inFlight.promise;
    }

    if (!operationLockManager()) {
      const storageError = new SettlementStorageError(
        "Settlement operation coordination is unavailable",
      );
      updateState(emptyState("storage_error", storageError));
      return Promise.reject(storageError);
    }

    const generation = generationRef.current;
    const promise = withOperationLock(ownerId, async (): Promise<RecordSettlementsResult | null> => {
      if (!isCurrent(initialRequest, ownerId, generation)) {
        throw new SettlementOutcomeUnknownError();
      }

      let storedRequest: RecordSettlementsRequest | null;
      try {
        storedRequest = readStoredRequest(ownerId);
      } catch (error) {
        const storageError = error instanceof SettlementStorageCorruptionError
          ? error
          : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
        updateState(blockedState(initialRequest, storageError));
        throw storageError;
      }

      let request = initialRequest;
      if (storedRequest) {
        if (
          storedRequest.operationId === initialRequest.operationId &&
          !requestsMatch(storedRequest, initialRequest)
        ) {
          const storageError = new SettlementStorageCorruptionError(
            "Stored settlement operation differs from the active request",
          );
          updateState(blockedState(initialRequest, storageError));
          throw storageError;
        }
        request = storedRequest;
        if (storedRequest.operationId !== initialRequest.operationId) {
          updateState(activeState("reconciling", storedRequest));
        }
      }

      return reconcileStoredRequest(
        request,
        ownerId,
        generation,
        storedRequest !== null,
      );
    });

    reconcilePromiseRef.current = { operationId, promise };
    promise.then(
      () => {
        if (reconcilePromiseRef.current?.promise === promise) {
          reconcilePromiseRef.current = null;
        }
      },
      () => {
        if (reconcilePromiseRef.current?.promise === promise) {
          reconcilePromiseRef.current = null;
        }
      },
    );
    return promise;
  }, [isCurrent, reconcileStoredRequest, updateState]);

  const finishRestoredOperation = useCallback((
    request: RecordSettlementsRequest,
    ownerId: string,
    generation: number,
  ): void => {
    void reconcile(request.operationId).then(
      () => {
        if (
          userIdRef.current !== ownerId ||
          generationRef.current !== generation ||
          stateRef.current.request?.operationId !== request.operationId
        ) {
          return;
        }
        if (
          stateRef.current.phase === "committed" ||
          stateRef.current.phase === "rejected"
        ) {
          updateState(emptyState("idle"));
        }
      },
      (error) => {
        if (
          !(error instanceof SettlementDatabaseRejectionError) ||
          error instanceof SettlementOperationCorruptError ||
          userIdRef.current !== ownerId ||
          generationRef.current !== generation ||
          stateRef.current.request?.operationId !== request.operationId ||
          stateRef.current.phase !== "rejected"
        ) {
          return;
        }
        updateState(emptyState("idle"));
      },
    );
  }, [reconcile, updateState]);

  const submit = useCallback(async (
    allocations: readonly SettlementAllocation[],
  ): Promise<RecordSettlementsResult> => {
    const ownerId = userIdRef.current;
    const current = stateRef.current;
    if (!ownerId) {
      throw new Error("An authenticated account is required to submit a settlement");
    }
    if (current.phase !== "idle" && current.phase !== "storage_error") {
      throw new Error("A settlement operation is already active");
    }
    if (submitGuardRef.current) {
      throw new Error("A settlement operation is already active");
    }
    if (!operationLockManager()) {
      const storageError = new SettlementStorageError(
        "Settlement operation coordination is unavailable",
      );
      updateState(emptyState("storage_error", storageError));
      throw storageError;
    }

    submitGuardRef.current = true;
    const generation = generationRef.current;
    try {
      return await withOperationLock(ownerId, async () => {
        if (
          userIdRef.current !== ownerId ||
          generationRef.current !== generation
        ) {
          throw new SettlementOutcomeUnknownError();
        }

        let storedRequest: RecordSettlementsRequest | null;
        try {
          storedRequest = readStoredRequest(ownerId);
        } catch (error) {
          const storageError = error instanceof SettlementStorageCorruptionError
            ? error
            : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
          updateState(blockedState(null, storageError));
          throw storageError;
        }

        if (storedRequest) {
          updateState(activeState("reconciling", storedRequest));
          const result = await reconcileStoredRequest(
            storedRequest,
            ownerId,
            generation,
            true,
          );
          if (!result) {
            throw new SettlementOutcomeUnknownError();
          }
          return result;
        }

        const currentAfterLock = stateRef.current;
        const hasReservedEdge = allocations.some((allocation) =>
          currentAfterLock.reservedEdgeKeys.has(settlementEdgeKey(allocation))
        );
        if (
          (currentAfterLock.phase !== "idle" &&
            currentAfterLock.phase !== "storage_error") ||
          hasReservedEdge
        ) {
          throw new Error("A settlement operation is already active");
        }

        const request = freezeRequest(crypto.randomUUID(), allocations);
        try {
          persistRequest(ownerId, request);
        } catch (error) {
          const storageError = error instanceof SettlementStorageError
            ? error
            : new SettlementStorageError("Settlement operation could not be persisted");
          updateState(emptyState("storage_error", storageError));
          throw storageError;
        }

        if (
          userIdRef.current !== ownerId ||
          generationRef.current !== generation
        ) {
          throw new SettlementOutcomeUnknownError();
        }

        updateState(activeState("submitting", request));
        return recordRequest(request, ownerId, generation);
      });
    } catch (error) {
      if (
        error instanceof SettlementStorageError &&
        stateRef.current.phase === "idle"
      ) {
        updateState(emptyState("storage_error", error));
      }
      throw error;
    } finally {
      submitGuardRef.current = false;
    }
  }, [recordRequest, reconcileStoredRequest, updateState]);

  const finish = useCallback((operationId: string): void => {
    const current = stateRef.current;
    if (
      !current.request ||
      current.request.operationId !== operationId ||
      (current.phase !== "committed" && current.phase !== "rejected")
    ) {
      return;
    }

    if (current.phase === "committed") {
      const ownerId = userIdRef.current;
      if (ownerId && !removeStoredRequest(ownerId)) {
        return;
      }
    }

    updateState(emptyState("idle"));
  }, [updateState]);

  useLayoutEffect(() => {
    userIdRef.current = userId;
    generationRef.current += 1;
    const generation = generationRef.current;
    submitGuardRef.current = false;
    reconcilePromiseRef.current = null;
    updateState(emptyState("restoring"));

    if (!userId) {
      return;
    }

    let request: RecordSettlementsRequest | null;
    try {
      request = readStoredRequest(userId);
    } catch (error) {
      const storageError = error instanceof SettlementStorageCorruptionError
        ? error
        : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
      updateState(blockedState(null, storageError));
      return;
    }

    if (!request) {
      updateState(emptyState("idle"));
      return;
    }

    updateState(activeState("reconciling", request));
    finishRestoredOperation(request, userId, generation);
  }, [finishRestoredOperation, updateState, userId]);

  useLayoutEffect(() => {
    if (!userId) {
      return;
    }

    const ownerId = userId;
    const key = storageKey(ownerId);
    const synchronize = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) {
        return;
      }
      if (userIdRef.current !== ownerId) {
        return;
      }

      const generation = generationRef.current;
      if (event.newValue === null) {
        const request = stateRef.current.request;
        if (request) {
          finishRestoredOperation(request, ownerId, generation);
        }
        return;
      }

      let request: RecordSettlementsRequest;
      try {
        request = parseStoredRequest(event.newValue);
      } catch (error) {
        const storageError = error instanceof SettlementStorageCorruptionError
          ? error
          : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
        updateState(blockedState(null, storageError));
        return;
      }

      updateState(activeState("reconciling", request));
      finishRestoredOperation(request, ownerId, generation);
    };

    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [finishRestoredOperation, updateState, userId]);

  const value = useMemo<SettlementSubmissionContextValue>(() => ({
    phase: state.phase,
    request: state.request,
    result: state.result,
    error: state.error,
    ready: userId !== null && state.phase !== "restoring" && state.phase !== "reconciling",
    reservedEdgeKeys: state.reservedEdgeKeys,
    submit,
    reconcile,
    finish,
  }), [finish, reconcile, state, submit, userId]);

  return (
    <SettlementSubmissionContext.Provider value={value}>
      {children}
    </SettlementSubmissionContext.Provider>
  );
}

export function useSettlementSubmission(): SettlementSubmissionContextValue {
  const value = useContext(SettlementSubmissionContext);
  if (!value) {
    throw new Error("useSettlementSubmission must be used within SettlementSubmissionProvider");
  }
  return value;
}
