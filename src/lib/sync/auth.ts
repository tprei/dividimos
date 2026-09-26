import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import { archiveCurrentDraft, restoreAccountDraft } from "@/lib/bill-draft-isolation";
import { runBootstrap } from "./bootstrap";
import {
  advanceAuthGeneration,
  getSupabase,
} from "./client";
import { invalidateSyncReads } from "./refresh";
import {
  detachLocalPushForSignOut,
  detachPushForSignOut,
} from "@/lib/push/detach";
import { clearPendingVendorChargeCancellations } from "./mutations-group";
import { invalidateNativeRegistration } from "@/lib/push/native-registration";
import {
  clearAllAssignmentRoomCredentials,
  resetAssignmentRoomRuntime,
} from "./assignment-rooms";
import { stopAllAssignmentRoomRealtime } from "./assignment-room-realtime";
import { clearAvatarCaches } from "@/lib/platform/avatar-cache";

function waitForAppStoreHydration(): Promise<void> {
  if (useAppStore.getState().hydrated) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubFinish();
      unsubStore();
      resolve();
    };
    const unsubFinish = useAppStore.persist.onFinishHydration(() => {
      finish();
    });
    const unsubStore = useAppStore.subscribe((state) => {
      if (state.hydrated) {
        finish();
      }
    });
    if (useAppStore.getState().hydrated) {
      finish();
    }
  });
}

type IdentityEvent = "SIGNED_IN" | "SIGNED_OUT";

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
  /**
   * Events that arrived before the app store hydrated. Supabase runs this
   * callback while holding its auth lock, and every getSession/RPC waits on
   * that lock, so the callback never awaits: it queues until hydration and
   * replays in arrival order.
   */
  let pending: Array<{ event: IdentityEvent; userId: string | null }> | null = null;

  const priorUserId = (): string | null =>
    observedUserId === undefined ? useAppStore.getState().me?.id ?? null : observedUserId;

  const handle = (event: IdentityEvent, nextUserId: string | null) => {
    if (event === "SIGNED_OUT") {
      const signedOutUserId = priorUserId();
      archiveCurrentDraft(signedOutUserId);
      useBillStore.getState().reset();
      observedUserId = null;
      advanceAuthGeneration();
      stopAllAssignmentRoomRealtime();
      resetAssignmentRoomRuntime();
      clearAllAssignmentRoomCredentials();
      invalidateNativeRegistration();
      invalidateSyncReads();
      clearPendingVendorChargeCancellations();
      clearAvatarCaches();
      void detachLocalPushForSignOut(signedOutUserId);
      useAppStore.getState().reset();
      onSignedOut();
      return;
    }

    if (nextUserId === null) return;

    // Comparing against the remembered identity catches A -> B -> A, where the
    // store is momentarily empty because a reset already ran.
    if (nextUserId === priorUserId()) {
      observedUserId = nextUserId;
      return;
    }

    const previousUserId = priorUserId();
    observedUserId = nextUserId;
    advanceAuthGeneration();
    stopAllAssignmentRoomRealtime();
    resetAssignmentRoomRuntime();
    if (previousUserId !== null) clearAllAssignmentRoomCredentials();
    invalidateNativeRegistration();
    invalidateSyncReads();
    clearPendingVendorChargeCancellations();
    archiveCurrentDraft(previousUserId);
    useBillStore.getState().reset();
    restoreAccountDraft(nextUserId);
    // The archived payload was written to the persist key by hand; pull it into
    // the in-memory store so the first mutation does not overwrite it with the
    // just-reset state.
    void useBillStore.persist.rehydrate();
    useAppStore.getState().reset();
    runBootstrap().catch(onError);
  };

  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    // TOKEN_REFRESHED and INITIAL_SESSION fire often without changing who is
    // signed in; invalidating on them would cancel healthy in-flight work.
    if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
    const userId = session?.user.id ?? null;

    if (pending) {
      pending.push({ event, userId });
      return;
    }
    if (observedUserId === undefined && !useAppStore.getState().hydrated) {
      pending = [{ event, userId }];
      void waitForAppStoreHydration().then(() => {
        const queued = pending ?? [];
        pending = null;
        for (const entry of queued) {
          if (disposed) return;
          handle(entry.event, entry.userId);
        }
      });
      return;
    }
    handle(event, userId);
  });

  return () => {
    if (disposed) return;
    // Mark disposed before unsubscribing so a callback already queued for this
    // listener cannot act, and advance once so an old root's in-flight requests
    // cannot publish into a remounted root.
    disposed = true;
    data.subscription.unsubscribe();
    advanceAuthGeneration();
    stopAllAssignmentRoomRealtime();
    resetAssignmentRoomRuntime();
    invalidateNativeRegistration();
  };
}

export type SignOutResult =
  | { ok: true }
  | { ok: false; error: unknown };

export async function signOut(): Promise<SignOutResult> {
  try {
    await detachPushForSignOut();
    const { error } = await getSupabase().auth.signOut();
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
