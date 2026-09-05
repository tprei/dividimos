import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdbStorage } from "./idb-storage";

describe("createIdbStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades to a no-op storage without indexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const storage = createIdbStorage("dividimos-test", "app");
    await expect(storage.getItem("state")).resolves.toBeNull();
    await expect(storage.setItem("state", "{}")).resolves.toBeUndefined();
    await expect(storage.removeItem("state")).resolves.toBeUndefined();
  });
});
