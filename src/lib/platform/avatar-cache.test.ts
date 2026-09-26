import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAvatarCaches } from "./avatar-cache";

describe("clearAvatarCaches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deletes only the service worker's avatar caches", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => [
        "dividimos-static-v7",
        "dividimos-avatars-v7",
        "dividimos-avatars-v6",
        "dividimos-runtime-v7",
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });

    clearAvatarCaches();

    await vi.waitFor(() => {
      expect(deleted).toEqual(["dividimos-avatars-v7", "dividimos-avatars-v6"]);
    });
  });

  it("logs and carries on when Cache Storage rejects", async () => {
    vi.stubGlobal("caches", {
      keys: async () => {
        throw new Error("storage unavailable");
      },
      delete: async () => true,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => clearAvatarCaches()).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "[avatar-cache] clearing caches on sign-out failed:",
        expect.objectContaining({ message: "storage unavailable" }),
      );
    });
  });

  it("does nothing when Cache Storage is unavailable", () => {
    expect(() => clearAvatarCaches()).not.toThrow();
  });
});
