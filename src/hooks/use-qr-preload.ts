"use client";

import { useEffect, useRef } from "react";

/**
 * Preloads the qr-scanner WASM module in the background so that
 * the QR scanner view starts faster when the user opens it.
 *
 * Call this early in a page that may navigate to the scanner
 * (e.g., the bill wizard). The import is fire-and-forget —
 * the module is cached by the JS runtime for subsequent imports.
 */
export function useQrScannerPreload() {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Dynamic import caches the module — subsequent `import("qr-scanner")`
    // calls in QrScannerView will resolve instantly from cache.
    import("qr-scanner").catch(() => {
      // Silently ignore — the scanner will retry on mount.
      // This can fail in environments without Worker/WASM support.
    });
  }, []);
}
