import { beforeEach, describe, expect, it } from "vitest";
import { removeAccountDraft, setDraftOwner } from "./bill-draft-isolation";
import { useBillStore } from "@/stores/bill-store";

const liveKey = useBillStore.persist.getOptions().name ?? "dividimos-draft";

describe("removeAccountDraft", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("drops a live draft written before owners were tracked", () => {
    window.localStorage.setItem(liveKey, "{\"state\":{}}");
    window.localStorage.setItem(`${liveKey}:user-a`, "{\"state\":{}}");

    removeAccountDraft("user-a");

    expect(window.localStorage.getItem(liveKey)).toBeNull();
    expect(window.localStorage.getItem(`${liveKey}:user-a`)).toBeNull();
  });

  it("keeps another account's live draft", () => {
    window.localStorage.setItem(liveKey, "{\"state\":{}}");
    setDraftOwner("user-b");

    removeAccountDraft("user-a");

    expect(window.localStorage.getItem(liveKey)).toBe("{\"state\":{}}");
  });
});
