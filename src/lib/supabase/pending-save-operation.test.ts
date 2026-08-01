import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setPendingSaveOperation,
  clearPendingSaveOperation,
  clearPendingSaveOperationIfMatches,
  peekPendingSaveOperation,
} from "@/lib/supabase/pending-save-operation";

const STORAGE_KEY = "dividimos:pending_save_operation";

describe("pending-save-operation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("peeks a freshly set entry without consuming it", () => {
    setPendingSaveOperation("op-1", "group-1");

    const first = peekPendingSaveOperation();
    expect(first).toEqual({
      operationId: "op-1",
      groupId: "group-1",
      timestamp: expect.any(Number),
    });

    // #477 review finding (637i): a destructive read would lose the only
    // durable record of an in-flight save before its outcome is confirmed.
    // Peeking twice must return the same entry both times.
    const second = peekPendingSaveOperation();
    expect(second).toEqual(first);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("returns null when there is no pending entry", () => {
    expect(peekPendingSaveOperation()).toBeNull();
  });

  it("returns null for unparseable JSON without throwing", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(peekPendingSaveOperation()).toBeNull();
  });

  it("returns null and clears storage for an entry missing required fields", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ operationId: "op-1" }));
    expect(peekPendingSaveOperation()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("discards and clears an entry older than 5 minutes", () => {
    const staleTimestamp = Date.now() - 6 * 60 * 1000;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", groupId: "group-1", timestamp: staleTimestamp }),
    );
    expect(peekPendingSaveOperation()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps a 4-minute-old entry (within the staleness window)", () => {
    const recentTimestamp = Date.now() - 4 * 60 * 1000;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ operationId: "op-1", groupId: "group-1", timestamp: recentTimestamp }),
    );
    expect(peekPendingSaveOperation()).toEqual({
      operationId: "op-1",
      groupId: "group-1",
      timestamp: recentTimestamp,
    });
  });

  it("clearPendingSaveOperation unconditionally removes the entry", () => {
    setPendingSaveOperation("op-1", "group-1");
    clearPendingSaveOperation();
    expect(peekPendingSaveOperation()).toBeNull();
  });

  it("clearPendingSaveOperationIfMatches removes the entry when the operation id matches", () => {
    setPendingSaveOperation("op-1", "group-1");
    clearPendingSaveOperationIfMatches("op-1");
    expect(peekPendingSaveOperation()).toBeNull();
  });

  it("clearPendingSaveOperationIfMatches leaves a newer, interleaved entry untouched", () => {
    // #477 review finding (637i): mount-time resolution is async. If the
    // user starts a NEW durable save (overwriting the stored entry) before
    // an in-flight resolution's promise settles, resolving the OLD
    // operation must never delete the NEW save's recovery record.
    setPendingSaveOperation("op-old", "group-1");
    setPendingSaveOperation("op-new", "group-1");

    clearPendingSaveOperationIfMatches("op-old");

    expect(peekPendingSaveOperation()).toEqual({
      operationId: "op-new",
      groupId: "group-1",
      timestamp: expect.any(Number),
    });
  });

  it("clearPendingSaveOperationIfMatches is a no-op when there is no entry", () => {
    expect(() => clearPendingSaveOperationIfMatches("op-1")).not.toThrow();
    expect(peekPendingSaveOperation()).toBeNull();
  });

  it("setPendingSaveOperation overwrites any previous entry", () => {
    setPendingSaveOperation("op-1", "group-1");
    setPendingSaveOperation("op-2", "group-2");
    expect(peekPendingSaveOperation()).toEqual({
      operationId: "op-2",
      groupId: "group-2",
      timestamp: expect.any(Number),
    });
  });

  it("does not throw when localStorage.setItem fails", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(() => setPendingSaveOperation("op-1", "group-1")).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
