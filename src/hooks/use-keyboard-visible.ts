"use client";

import { useEffect, useState } from "react";

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function init() {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const showHandle = await Keyboard.addListener("keyboardWillShow", () => setVisible(true));
        const hideHandle = await Keyboard.addListener("keyboardWillHide", () => setVisible(false));

        cleanup = () => {
          showHandle.remove();
          hideHandle.remove();
        };
      } catch {
        // Not running in Capacitor — fall back to visualViewport API
        const vv = window.visualViewport;
        if (!vv) return;

        const threshold = 150;
        const handler = () => {
          const keyboardOpen = window.innerHeight - vv.height > threshold;
          setVisible(keyboardOpen);
        };

        vv.addEventListener("resize", handler);
        cleanup = () => vv.removeEventListener("resize", handler);
      }
    }

    init();

    return () => cleanup?.();
  }, []);

  return visible;
}
