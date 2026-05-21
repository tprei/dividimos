import { useEffect, useLayoutEffect, useRef } from "react";
import { pushBackHandler } from "@/lib/capacitor/back-handler";

export function useBackHandler(enabled: boolean, onClose: () => void): void {
  const latestRef = useRef(onClose);

  useLayoutEffect(() => {
    latestRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    const unregister = pushBackHandler(() => {
      latestRef.current();
      return true;
    });
    return unregister;
  }, [enabled]);
}
