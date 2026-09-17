import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraftIntent,
  DRAFT_INTENT_KEY,
  readDraftIntent,
  writeDraftIntent,
  type DraftIntent,
} from "./draft-intent";

describe("draftIntent storage operations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no intent is stored", () => {
    expect(readDraftIntent()).toBeNull();
  });

  it("writes and reads a create intent", () => {
    const intent: DraftIntent = { kind: "create", draftKey: "draft-key-123" };
    writeDraftIntent(intent);

    expect(readDraftIntent()).toEqual(intent);
  });

  it("writes and reads an edit intent", () => {
    const intent: DraftIntent = {
      kind: "edit",
      expenseId: "exp-123",
      expectedVersionNo: 2,
      draftKey: "draft-key-123",
    };
    writeDraftIntent(intent);

    expect(readDraftIntent()).toEqual(intent);
  });

  it("clears intent from storage", () => {
    writeDraftIntent({ kind: "create", draftKey: "draft-key-123" });
    clearDraftIntent();

    expect(readDraftIntent()).toBeNull();
  });

  it("handles corrupted storage safely by removing invalid json and returning null", () => {
    window.localStorage.setItem(DRAFT_INTENT_KEY, "invalid-json");
    expect(readDraftIntent()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
  });

  it("rejects malformed payload shapes and clears key", () => {
    window.localStorage.setItem(
      DRAFT_INTENT_KEY,
      JSON.stringify({ kind: "unknown", draftKey: "draft-1" }),
    );
    expect(readDraftIntent()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
  });
});
