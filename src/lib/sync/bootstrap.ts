import { decodeBootstrapOverviewV2 } from "@/lib/ledger/decode-group-overview";
import { LedgerError } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import { getAuthGeneration, rpc } from "./client";

let bootstrapInFlight: { generation: number; promise: Promise<void> } | null = null;
let bootstrapPending: { generation: number; promise: Promise<void> } | null = null;

async function executeBootstrap(generation: number): Promise<void> {
  const store = useAppStore.getState();
  // The membership set as it stood when the request left: the response cannot
  // speak for groups created or removed after this point.
  const knownGroupIds = Object.keys(store.groups);
  store.setBootstrapLoading();

  let data;
  try {
    data = await rpc("bootstrap_overview_v2", {}, decodeBootstrapOverviewV2);
  } catch (error) {
    // A failed read must not clear projections; it records why and rethrows so
    // the caller can retry.
    if (getAuthGeneration() === generation) {
      useAppStore
        .getState()
        .setBootstrapError(error instanceof LedgerError ? error.code : "unknown");
    }
    throw error;
  }

  // The account may have been replaced, signed out, or the root torn down
  // while this request was in flight; publishing then would resurrect data
  // belonging to a previous session.
  if (getAuthGeneration() !== generation) return;
  useAppStore.getState().applyBootstrap(data, knownGroupIds);
}

export function runBootstrap(): Promise<void> {
  const generation = getAuthGeneration();
  if (bootstrapInFlight === null || bootstrapInFlight.generation !== generation) {
    const entry: { generation: number; promise: Promise<void> } = {
      generation,
      promise: executeBootstrap(generation).finally(() => {
        // Clear only this request's entry: a newer generation's request must
        // survive an older one settling late.
        if (bootstrapInFlight === entry) bootstrapInFlight = null;
      }),
    };
    bootstrapInFlight = entry;
  }
  return bootstrapInFlight.promise;
}

export function catchUpBootstrap(): Promise<void> {
  const generation = getAuthGeneration();
  const current = bootstrapInFlight;
  if (current === null || current.generation !== generation) return runBootstrap();

  const pending = bootstrapPending;
  if (pending !== null && pending.generation === generation) return pending.promise;

  const entry: { generation: number; promise: Promise<void> } = {
    generation,
    promise: current.promise
      .catch(() => undefined)
      .then(() => {
        // Free the slot the moment this follow-up's read starts, not when it
        // settles: a call made during the read must queue behind it, not share
        // a read that already left.
        if (bootstrapPending === entry) bootstrapPending = null;
        if (getAuthGeneration() !== generation) return;
        return runBootstrap();
      }),
  };
  bootstrapPending = entry;
  return entry.promise;
}

async function bootstrapIfStale(maxAgeMs = 60_000): Promise<void> {
  const lastAt = useAppStore.getState().lastBootstrapAt;
  if (lastAt !== null) {
    const elapsed = Date.now() - Date.parse(lastAt);
    if (!Number.isNaN(elapsed) && elapsed < maxAgeMs) {
      return;
    }
  }
  await runBootstrap();
}

export function attachVisibilityRefresh(onError: (error: unknown) => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    bootstrapIfStale().catch(onError);
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
