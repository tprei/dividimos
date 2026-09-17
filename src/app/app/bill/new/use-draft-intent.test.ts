import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraftIntent,
  DRAFT_INTENT_KEY,
  readDraftIntent,
  writeDraftIntent,
  type DraftIntent,
} from "./use-draft-intent";

describe("useDraftIntent storage operations", () => {
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
      expenseId: "exp-456",
      expectedVersionNo: 3,
      draftKey: "draft-key-456",
    };
    writeDraftIntent(intent);

    expect(readDraftIntent()).toEqual(intent);
  });

  it("clears intent and returns null on corrupted JSON", () => {
    window.localStorage.setItem(DRAFT_INTENT_KEY, "not-valid-json{");

    expect(readDraftIntent()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
  });

  it("clears intent and returns null on invalid shape", () => {
    window.localStorage.setItem(
      DRAFT_INTENT_KEY,
      JSON.stringify({ kind: "edit", expenseId: "", expectedVersionNo: -1 }),
    );

    expect(readDraftIntent()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
  });

  it("clearDraftIntent removes the key from localStorage", () => {
    writeDraftIntent({ kind: "create", draftKey: "draft-key-789" });
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).not.toBeNull();

    clearDraftIntent();
    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
    expect(readDraftIntent()).toBeNull();
  });
});
