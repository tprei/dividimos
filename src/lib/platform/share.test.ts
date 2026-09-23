import { afterEach, describe, expect, it, vi } from "vitest";
import { isShareSupported, shareLink } from "./share";

function stubShare(share: unknown): void {
  vi.stubGlobal("navigator", { ...navigator, share });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isShareSupported", () => {
  it("is true when the browser exposes navigator.share", () => {
    stubShare(async () => {});

    expect(isShareSupported()).toBe(true);
  });

  it("is false when navigator.share is missing", () => {
    stubShare(undefined);

    expect(isShareSupported()).toBe(false);
  });
});

describe("shareLink", () => {
  it("shares the payload and reports shared", async () => {
    const share = vi.fn(async () => {});
    stubShare(share);

    await expect(
      shareLink({ title: "Dividimos", text: "Venha dividir", url: "https://dividimos.test/g/1" }),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Dividimos",
      text: "Venha dividir",
      url: "https://dividimos.test/g/1",
    });
  });

  it("reports dismissed when the user closes the share sheet", async () => {
    stubShare(
      vi.fn(async () => {
        throw new DOMException("cancel", "AbortError");
      }),
    );

    await expect(shareLink({ url: "https://dividimos.test/g/1" })).resolves.toBe("dismissed");
  });

  it("reports unsupported when there is no share API", async () => {
    stubShare(undefined);

    await expect(shareLink({ url: "https://dividimos.test/g/1" })).resolves.toBe("unsupported");
  });

  it("reports unsupported when sharing fails", async () => {
    stubShare(
      vi.fn(async () => {
        throw new Error("share failed");
      }),
    );

    await expect(shareLink({ url: "https://dividimos.test/g/1" })).resolves.toBe("unsupported");
  });
});
