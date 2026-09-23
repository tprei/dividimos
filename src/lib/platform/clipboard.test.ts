import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, readClipboardText } from "./clipboard";

const writeText = vi.fn<(text: string) => Promise<void>>();
const readText = vi.fn<() => Promise<string>>();

function stubClipboard(clipboard: unknown): void {
  vi.stubGlobal("navigator", { ...navigator, clipboard });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("copyText", () => {
  it("returns true when the clipboard accepts the write", async () => {
    writeText.mockResolvedValue(undefined);
    stubClipboard({ writeText });

    await expect(copyText("https://dividimos.test/g/1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://dividimos.test/g/1");
  });

  it("returns false when the clipboard rejects the write", async () => {
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubClipboard({ writeText });

    await expect(copyText("https://dividimos.test/g/1")).resolves.toBe(false);
  });

  it("returns false when there is no clipboard API", async () => {
    stubClipboard(undefined);

    await expect(copyText("https://dividimos.test/g/1")).resolves.toBe(false);
  });
});

describe("readClipboardText", () => {
  it("returns the clipboard contents", async () => {
    readText.mockResolvedValue("pix-key");
    stubClipboard({ readText });

    await expect(readClipboardText()).resolves.toBe("pix-key");
  });

  it("returns null when reading is denied", async () => {
    readText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubClipboard({ readText });

    await expect(readClipboardText()).resolves.toBe(null);
  });

  it("returns null when there is no clipboard API", async () => {
    stubClipboard(undefined);

    await expect(readClipboardText()).resolves.toBe(null);
  });
});
