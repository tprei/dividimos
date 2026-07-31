import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingSaveOperation,
  consumePendingSaveOperation,
  setPendingSaveOperation,
} from "./pending-save-operation";

const STORAGE_KEY = "dividimos:pending_save_operation";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("setPendingSaveOperation", () => {
  it("persists the operation and group ID with a timestamp", () => {
    setPendingSaveOperation("op-1", "group-1");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.operationId).toBe("op-1");
    expect(parsed.groupId).toBe("group-1");
    expect(typeof parsed.timestamp).toBe("number");
  });

  it("overwrites any previous entry (only one pending save per tab)", () => {
    setPendingSaveOperation("op-1", "group-1");
    setPendingSaveOperation("op-2", "group-2");
    const entry = consumePendingSaveOperation();
    expect(entry?.operationId).toBe("op-2");
    expect(entry?.groupId).toBe("group-2");
  });

  it("does not throw and stores nothing when localStorage.setItem is unavailable", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => setPendingSaveOperation("op-1", "group-1")).not.toThrow();
    expect(consumePendingSaveOperation()).toBeNull();
  });
});

describe("clearPendingSaveOperation", () => {
  it("removes the stored entry", () => {
    setPendingSaveOperation("op-1", "group-1");
    clearPendingSaveOperation();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("does not throw when nothing is stored", () => {
    expect(() => clearPendingSaveOperation()).not.toThrow();
  });

  it("does not throw when localStorage.removeItem is unavailable", () => {
    setPendingSaveOperation("op-1", "group-1");
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => clearPendingSaveOperation()).not.toThrow();
  });
});

describe("consumePendingSaveOperation", () => {
  it("returns null when there is no pending entry", () => {
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("returns the entry and consumes it (removes it from storage)", () => {
    setPendingSaveOperation("op-1", "group-1");
    const entry = consumePendingSaveOperation();
    expect(entry).toEqual({
      operationId: "op-1",
      groupId: "group-1",
      timestamp: expect.any(Number),
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns null and consumes on a second read (single-shot recovery)", () => {
    setPendingSaveOperation("op-1", "group-1");
    consumePendingSaveOperation();
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{");
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("returns null when operationId is missing or the wrong type", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ groupId: "group-1", timestamp: Date.now() }),
    );
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("returns null when groupId is missing or the wrong type", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", timestamp: Date.now() }),
    );
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("returns null when timestamp is missing or the wrong type", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", groupId: "group-1", timestamp: "not-a-number" }),
    );
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("discards entries older than 5 minutes as stale", () => {
    const staleTimestamp = Date.now() - 5 * 60 * 1000 - 1;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", groupId: "group-1", timestamp: staleTimestamp }),
    );
    expect(consumePendingSaveOperation()).toBeNull();
  });

  it("keeps an entry just under the 5-minute staleness threshold", () => {
    const freshTimestamp = Date.now() - 5 * 60 * 1000 + 1000;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", groupId: "group-1", timestamp: freshTimestamp }),
    );
    const entry = consumePendingSaveOperation();
    expect(entry?.operationId).toBe("op-1");
  });

  it("returns null when localStorage.getItem throws", () => {
    setPendingSaveOperation("op-1", "group-1");
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(consumePendingSaveOperation()).toBeNull();
  });
});
