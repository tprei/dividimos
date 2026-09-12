import { useAppStore } from "@/stores/app-store";
import { runBootstrap } from "./bootstrap";
import { getSupabase } from "./client";
import { clearPendingVendorChargeCancellations } from "./mutations-group";

export function attachAuthListener(
  onSignedOut: () => void,
  onError: (error: unknown) => void,
): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      clearPendingVendorChargeCancellations();
      useAppStore.getState().reset();
      onSignedOut();
      return;
    }

    if (event === "SIGNED_IN") {
      const me = useAppStore.getState().me;
      if (me !== null && session?.user.id !== me.id) {
        clearPendingVendorChargeCancellations();
        useAppStore.getState().reset();
        runBootstrap().catch(onError);
      }
    }
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
