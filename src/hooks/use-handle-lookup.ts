import { useCallback, useEffect, useRef, useState } from "react";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import type { UserProfile } from "@/types/ledger";

export type HandleLookup =
  | { status: "idle" }
  | { status: "loading"; handle: string }
  | { status: "found"; handle: string; profile: UserProfile }
  | { status: "not_found"; handle: string }
  | { status: "failed"; handle: string };

interface SettledLookup {
  profile: UserProfile | null;
  failed: boolean;
}

interface LookupState {
  handle: string | null;
  generation: number;
  settled: SettledLookup | null;
}

export function useHandleLookup(handle: string | null): { lookup: HandleLookup; retry: () => void } {
  const [state, setState] = useState<LookupState>({ handle, generation: 0, settled: null });
  const timerRef = useRef<number | undefined>(undefined);
  if (state.handle !== handle) {
    setState({ handle, generation: state.generation + 1, settled: null });
  }

  useEffect(() => {
    if (handle === null) return;
    const generation = state.generation;
    const controller = new AbortController();
    timerRef.current = window.setTimeout(
      async () => {
        try {
          const profile = await lookupUserByHandle(handle, controller.signal);
          if (!controller.signal.aborted) {
            setState((current) =>
              current.generation === generation && current.handle === handle
                ? { ...current, settled: { profile, failed: false } }
                : current,
            );
          }
        } catch {
          if (!controller.signal.aborted) {
            setState((current) =>
              current.generation === generation && current.handle === handle
                ? { ...current, settled: { profile: null, failed: true } }
                : current,
            );
          }
        }
      },
      500,
    );
    return () => {
      clearTimeout(timerRef.current);
      controller.abort();
    };
  }, [handle, state.generation]);

  const retry = useCallback(() => {
    setState((current) => ({
      handle: current.handle,
      generation: current.generation + 1,
      settled: null,
    }));
  }, []);

  if (handle === null) return { lookup: { status: "idle" }, retry };
  const settled = state.settled;
  if (settled === null) return { lookup: { status: "loading", handle }, retry };
  if (settled.failed) return { lookup: { status: "failed", handle }, retry };
  if (settled.profile === null) return { lookup: { status: "not_found", handle }, retry };
  return { lookup: { status: "found", handle, profile: settled.profile }, retry };
}
