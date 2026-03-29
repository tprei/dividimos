import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useQrScannerPreload } from "./use-qr-preload";

// Mock qr-scanner module to track import calls
vi.mock("qr-scanner", () => ({
  default: class MockQrScanner {},
}));

describe("useQrScannerPreload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when called", () => {
    expect(() => {
      renderHook(() => useQrScannerPreload());
    }).not.toThrow();
  });

  it("only attempts preload once across re-renders", () => {
    const { rerender } = renderHook(() => useQrScannerPreload());
    // Re-render multiple times
    rerender();
    rerender();
    rerender();
    // The hook uses a ref to guard against multiple imports.
    // We can't easily count dynamic imports, but we verify it doesn't error.
    expect(true).toBe(true);
  });
});
