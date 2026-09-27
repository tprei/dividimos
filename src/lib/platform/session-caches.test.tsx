import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionCaches } from "./session-caches";

describe("clearSessionCaches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deletes the avatar and app shell caches and keeps the offline page", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => [
        "dividimos-static-v8",
        "dividimos-avatars-v8",
        "dividimos-shell-v8",
        "dividimos-shell-v7",
        "dividimos-runtime-v8",
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });

    clearSessionCaches();

    await vi.waitFor(() => {
      expect(deleted).toEqual(["dividimos-avatars-v8", "dividimos-shell-v8", "dividimos-shell-v7"]);
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

    expect(() => clearSessionCaches()).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: "storage unavailable" }),
      );
    });
  });

  it("does nothing when Cache Storage is unavailable", () => {
    expect(() => clearSessionCaches()).not.toThrow();
  });
});
