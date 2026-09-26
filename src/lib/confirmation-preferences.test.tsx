import { beforeEach, describe, expect, it } from "vitest";
import {
  readConfirmationPreferences,
  updateConfirmationPreferences,
} from "./confirmation-preferences";

describe("confirmation-preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    const prefs = readConfirmationPreferences("user-1");
    expect(prefs).toEqual({
      confirmVoidSettlement: true,
      scanDraftChoice: "ask",
    });
  });

  it("round-trips preferences after update", () => {
    const updated = updateConfirmationPreferences("user-1", {
      confirmVoidSettlement: false,
      scanDraftChoice: "replace",
    });

    expect(updated).toEqual({
      confirmVoidSettlement: false,
      scanDraftChoice: "replace",
    });

    const read = readConfirmationPreferences("user-1");
    expect(read).toEqual({
      confirmVoidSettlement: false,
      scanDraftChoice: "replace",
    });
  });

  it("falls back to defaults on corrupt JSON in storage", () => {
    window.localStorage.setItem(
      "dividimos-prefs:http://localhost:54321:user-1",
      "not-valid-json{",
    );

    const prefs = readConfirmationPreferences("user-1");
    expect(prefs).toEqual({
      confirmVoidSettlement: true,
      scanDraftChoice: "ask",
    });
  });

  it("falls back to ask when scanDraftChoice has an unknown value", () => {
    window.localStorage.setItem(
      "dividimos-prefs:http://localhost:54321:user-1",
      JSON.stringify({
        confirmVoidSettlement: false,
        scanDraftChoice: "invalid-choice",
      }),
    );

    const prefs = readConfirmationPreferences("user-1");
    expect(prefs).toEqual({
      confirmVoidSettlement: false,
      scanDraftChoice: "ask",
    });
  });

  it("ensures two user ids do not share values", () => {
    updateConfirmationPreferences("user-1", {
      confirmVoidSettlement: false,
      scanDraftChoice: "keep",
    });

    const user1Prefs = readConfirmationPreferences("user-1");
    const user2Prefs = readConfirmationPreferences("user-2");

    expect(user1Prefs).toEqual({
      confirmVoidSettlement: false,
      scanDraftChoice: "keep",
    });

    expect(user2Prefs).toEqual({
      confirmVoidSettlement: true,
      scanDraftChoice: "ask",
    });
  });

  it("returns defaults when userId is empty", () => {
    const prefs = readConfirmationPreferences("");
    expect(prefs).toEqual({
      confirmVoidSettlement: true,
      scanDraftChoice: "ask",
    });
  });
});
