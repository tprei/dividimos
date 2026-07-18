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
  const reconcilePromiseRef = useRef<Promise<RecordSettlementsResult | null> | null>(null);

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

  const removeStoredRequest = useCallback((ownerId: string): boolean => {
    try {
      window.sessionStorage.removeItem(storageKey(ownerId));
      return true;
    } catch {
      return false;
    }
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
        for (const allocation of request.allocations) {
          void notifySettlementRecorded(
            allocation.groupId,
            allocation.fromUserId,
            allocation.toUserId,
            allocation.amountCents,
          );
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
  }, [isCurrent, removeStoredRequest, updateState]);

  const reconcile = useCallback((operationId: string): Promise<RecordSettlementsResult | null> => {
    const request = stateRef.current.request;
    const ownerId = userIdRef.current;
    if (!request || !ownerId || request.operationId !== operationId) {
      return Promise.resolve(null);
    }

    if (reconcilePromiseRef.current) {
      return reconcilePromiseRef.current;
    }

    const generation = generationRef.current;
    updateState(activeState("reconciling", request));
    const promise = (async () => {
      let settlements: Settlement[] | null;
      try {
        settlements = await getSettlementOperation(operationId);
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
          operationId,
          settlements,
          replayed: true,
        });
        removeStoredRequest(ownerId);
        updateState(committedState(request, result));
        return result;
      }

      updateState(activeState("submitting", request));
      return recordRequest(request, ownerId, generation);
    })();

    reconcilePromiseRef.current = promise;
    promise.then(
      () => {
        if (reconcilePromiseRef.current === promise) {
          reconcilePromiseRef.current = null;
        }
      },
      () => {
        if (reconcilePromiseRef.current === promise) {
          reconcilePromiseRef.current = null;
        }
      },
    );
    return promise;
  }, [isCurrent, recordRequest, removeStoredRequest, updateState]);

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

    submitGuardRef.current = true;
    const generation = generationRef.current;
    const key = storageKey(ownerId);
    let existing: string | null;
    try {
      existing = window.sessionStorage.getItem(key);
    } catch {
      submitGuardRef.current = false;
      const storageError = new SettlementStorageCorruptionError(
        "Stored settlement operation could not be read",
      );
      updateState(blockedState(null, storageError));
      throw storageError;
    }

    if (existing !== null) {
      let storedRequest: RecordSettlementsRequest;
      try {
        storedRequest = parseStoredRequest(existing);
      } catch (error) {
        submitGuardRef.current = false;
        const storageError = error instanceof SettlementStorageCorruptionError
          ? error
          : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
        updateState(blockedState(null, storageError));
        throw storageError;
      }

      updateState(activeState("reconciling", storedRequest));
      submitGuardRef.current = false;
      const result = await reconcile(storedRequest.operationId);
      if (!result) {
        throw new SettlementOutcomeUnknownError();
      }
      return result;
    }

    const request = freezeRequest(crypto.randomUUID(), allocations);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(request));
    } catch {
      submitGuardRef.current = false;
      const storageError = new SettlementStorageError("Settlement operation could not be persisted");
      updateState(emptyState("storage_error", storageError));
      throw storageError;
    }

    if (
      userIdRef.current !== ownerId ||
      generationRef.current !== generation
    ) {
      submitGuardRef.current = false;
      throw new SettlementOutcomeUnknownError();
    }

    updateState(activeState("submitting", request));
    submitGuardRef.current = false;
    return recordRequest(request, ownerId, generation);
  }, [reconcile, recordRequest, updateState]);

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
  }, [removeStoredRequest, updateState]);

  useLayoutEffect(() => {
    userIdRef.current = userId;
    generationRef.current += 1;
    submitGuardRef.current = false;
    reconcilePromiseRef.current = null;
    updateState(emptyState("restoring"));

    if (!userId) {
      return;
    }

    let serialized: string | null;
    try {
      serialized = window.sessionStorage.getItem(storageKey(userId));
    } catch {
      updateState(
        blockedState(
          null,
          new SettlementStorageCorruptionError("Stored settlement operation could not be read"),
        ),
      );
      return;
    }

    if (serialized === null) {
      updateState(emptyState("idle"));
      return;
    }

    let request: RecordSettlementsRequest;
    try {
      request = parseStoredRequest(serialized);
    } catch (error) {
      const storageError = error instanceof SettlementStorageCorruptionError
        ? error
        : new SettlementStorageCorruptionError("Stored settlement operation is invalid");
      updateState(blockedState(null, storageError));
      return;
    }

    updateState(activeState("reconciling", request));
    void reconcile(request.operationId);
  }, [reconcile, updateState, userId]);

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
