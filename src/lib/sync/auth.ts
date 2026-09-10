import { useAppStore } from "@/stores/app-store";
import { runBootstrap } from "./bootstrap";
import { advanceAuthGeneration, getSupabase } from "./client";
import { clearPendingVendorChargeCancellations } from "./mutations-group";
import { detachPushForSignOut } from "@/lib/push/detach";

export function attachAuthListener(
  onSignedOut: () => void,
  onError: (error: unknown) => void,
): () => void {
  /**
   * `undefined` means no identity event has been observed yet, so the prior
   * identity must come from the store. An explicit `null` records a real
   * sign-out and must not fall back to stale stored data.
   */
  let observedUserId: string | null | undefined;
  let disposed = false;

  const priorUserId = (): string | null =>
    observedUserId === undefined ? useAppStore.getState().me?.id ?? null : observedUserId;

  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (disposed) return;

    if (event === "SIGNED_OUT") {
      observedUserId = null;
      // Best-effort: the account losing the session must stop receiving on
      // this device, but teardown never waits on the network.
      void detachPushForSignOut();
      advanceAuthGeneration();
      clearPendingVendorChargeCancellations();
      useAppStore.getState().reset();
      onSignedOut();
      return;
    }

    // TOKEN_REFRESHED and INITIAL_SESSION fire often without changing who is
    // signed in; invalidating on them would cancel healthy in-flight work.
    if (event !== "SIGNED_IN") return;

    const nextUserId = session?.user.id ?? null;
    if (nextUserId === null) return;

    // Comparing against the remembered identity catches A -> B -> A, where the
    // store is momentarily empty because a reset already ran.
    if (nextUserId === priorUserId()) {
      observedUserId = nextUserId;
      return;
    }

    observedUserId = nextUserId;
    advanceAuthGeneration();
    clearPendingVendorChargeCancellations();
    useAppStore.getState().reset();
    runBootstrap().catch(onError);
  });

  return () => {
    if (disposed) return;
    // Mark disposed before unsubscribing so a callback already queued for this
    // listener cannot act, and advance once so an old root's in-flight requests
    // cannot publish into a remounted root.
    disposed = true;
    data.subscription.unsubscribe();
    advanceAuthGeneration();
  };
}

export type SignOutResult =
  | { ok: true }
  | { ok: false; error: unknown };

export async function signOut(): Promise<SignOutResult> {
  try {
    const { error } = await getSupabase().auth.signOut();
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
