"use client";

import { Keyboard } from "@capacitor/keyboard";
import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/capacitor/auth";

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function observeViewport(): (() => void) | undefined {
      const vv = window.visualViewport;
      if (!vv) return undefined;

      const threshold = 150;
      const handler = () => {
        setVisible(window.innerHeight - vv.height > threshold);
      };

      vv.addEventListener("resize", handler);
      return () => vv.removeEventListener("resize", handler);
    }

    async function observePlugin(): Promise<() => void> {
      const showHandle = await Keyboard.addListener("keyboardWillShow", () => setVisible(true));
      const hideHandle = await Keyboard.addListener("keyboardWillHide", () => setVisible(false));

      return () => {
        void showHandle.remove();
        void hideHandle.remove();
      };
    }

    if (!isNativePlatform()) {
      return observeViewport();
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void observePlugin().then((remove) => {
      if (disposed) {
        remove();
        return;
      }
      cleanup = remove;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return visible;
}
