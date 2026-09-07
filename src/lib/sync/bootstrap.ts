import { decodeBootstrap } from "@/lib/ledger/decode";
import { useAppStore } from "@/stores/app-store";
import { rpc } from "./client";

let bootstrapInFlight: Promise<void> | null = null;

async function executeBootstrap(): Promise<void> {
  const data = await rpc("bootstrap", {}, decodeBootstrap);
  useAppStore.getState().applyBootstrap(data);
}

export function runBootstrap(): Promise<void> {
  if (!bootstrapInFlight) {
    bootstrapInFlight = executeBootstrap().finally(() => {
      bootstrapInFlight = null;
    });
  }
  return bootstrapInFlight;
}

export async function bootstrapIfStale(maxAgeMs = 60_000): Promise<void> {
  const lastAt = useAppStore.getState().lastBootstrapAt;
  if (lastAt !== null) {
    const elapsed = Date.now() - Date.parse(lastAt);
    if (!Number.isNaN(elapsed) && elapsed < maxAgeMs) {
      return;
    }
  }
  await runBootstrap();
}

export function attachVisibilityRefresh(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void bootstrapIfStale();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
