import { useEffect } from "react";
import { pushBackHandler } from "@/lib/capacitor/back-handler";

export function useBackHandler(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    return pushBackHandler(() => {
      onClose();
      return true;
    });
  }, [enabled, onClose]);
}
