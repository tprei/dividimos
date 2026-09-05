import { useAppStore } from "@/stores/app-store";
import { runBootstrap } from "./bootstrap";
import { getSupabase } from "./client";

export function attachAuthListener(onSignedOut: () => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      useAppStore.getState().reset();
      onSignedOut();
      return;
    }

    if (event === "SIGNED_IN") {
      const me = useAppStore.getState().me;
      if (me !== null && session?.user.id !== me.id) {
        useAppStore.getState().reset();
        void runBootstrap();
      }
    }
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
