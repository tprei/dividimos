import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDuplicateReceipt,
  markReceiptScanned,
  clearReceiptRecord,
} from "./nfce-dedup";

const CHAVE = "35240199999999999999550010000001231234567890";

describe("nfce-dedup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("checkDuplicateReceipt", () => {
    it("returns null when no previous scan exists", () => {
      expect(checkDuplicateReceipt(CHAVE)).toBeNull();
    });

    it("returns the stored timestamp when a previous scan exists", () => {
      const timestamp = new Date(Date.now() - 1000).toISOString();
      localStorage.setItem(`nfce:${CHAVE}`, timestamp);
      expect(checkDuplicateReceipt(CHAVE)).toBe(timestamp);
    });

    it("returns null and removes entry when scan is older than 30 days", () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem(`nfce:${CHAVE}`, oldDate);
      expect(checkDuplicateReceipt(CHAVE)).toBeNull();
      expect(localStorage.getItem(`nfce:${CHAVE}`)).toBeNull();
    });

    it("returns timestamp when scan is within 30 days", () => {
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem(`nfce:${CHAVE}`, recentDate);
      expect(checkDuplicateReceipt(CHAVE)).toBe(recentDate);
    });

    it("returns null for invalid stored date", () => {
      localStorage.setItem(`nfce:${CHAVE}`, "not-a-date");
      expect(checkDuplicateReceipt(CHAVE)).toBeNull();
    });

    it("returns null when localStorage throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      expect(checkDuplicateReceipt(CHAVE)).toBeNull();
    });
  });

  describe("markReceiptScanned", () => {
    it("stores a timestamp in localStorage", () => {
      markReceiptScanned(CHAVE);
      const stored = localStorage.getItem(`nfce:${CHAVE}`);
      expect(stored).not.toBeNull();
      // Should be a valid ISO date
      expect(new Date(stored!).getTime()).not.toBeNaN();
    });

    it("does not throw when localStorage is unavailable", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      expect(() => markReceiptScanned(CHAVE)).not.toThrow();
    });
  });

  describe("clearReceiptRecord", () => {
    it("removes a stored entry", () => {
      markReceiptScanned(CHAVE);
      expect(localStorage.getItem(`nfce:${CHAVE}`)).not.toBeNull();
      clearReceiptRecord(CHAVE);
      expect(localStorage.getItem(`nfce:${CHAVE}`)).toBeNull();
    });

    it("does not throw when localStorage is unavailable", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      expect(() => clearReceiptRecord(CHAVE)).not.toThrow();
    });
  });
});
