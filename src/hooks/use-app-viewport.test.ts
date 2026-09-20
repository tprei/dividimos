import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppViewport } from "./use-app-viewport";

vi.mock("@/lib/capacitor/auth", () => ({
  isNativePlatform: () => false,
}));

interface FakeVisualViewport {
  height: number;
  width: number;
  offsetTop: number;
  scale: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

const FULL_HEIGHT = 844;
let listeners: (() => void)[] = [];
let viewport: FakeVisualViewport;

function emitResize() {
  for (const listener of [...listeners]) listener();
}

beforeEach(() => {
  listeners = [];
  viewport = {
    height: FULL_HEIGHT,
    width: 390,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners = listeners.filter((entry) => entry !== listener);
    },
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  window.innerHeight = FULL_HEIGHT;
  window.innerWidth = 390;
  document.documentElement.style.removeProperty("--app-viewport-height");
});

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-keyboard");
  vi.useRealTimers();
});

async function settle() {
  const { promise, resolve } = Promise.withResolvers<void>();
  await act(async () => {
    emitResize();
    requestAnimationFrame(() => resolve());
    await promise;
  });
}

describe("useAppViewport", () => {
  it("publishes the measured visual viewport to the document root", async () => {
    renderHook(() => useAppViewport());
    await settle();

    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-width")).toBe("390px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-top")).toBe("0px");
  });

  it("reports the keyboard when a focused text field loses screen height", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useAppViewport());
    await settle();
    expect(result.current.keyboardOpen).toBe(false);

    input.focus();
    viewport.height = FULL_HEIGHT - 336;
    await settle();

    expect(result.current.keyboardOpen).toBe(true);
    expect(document.documentElement.getAttribute("data-keyboard")).toBe("open");
  });

  it("keeps the keyboard flag while any mounted surface still reports one", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    // The shell always runs the hook; a chat sheet mounts a second instance.
    const shell = renderHook(() => useAppViewport());
    const sheet = renderHook(() => useAppViewport());
    await settle();

    input.focus();
    viewport.height = FULL_HEIGHT - 336;
    await settle();
    expect(document.documentElement.getAttribute("data-keyboard")).toBe("open");

    sheet.unmount();
    expect(document.documentElement.getAttribute("data-keyboard")).toBe("open");

    shell.unmount();
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(false);
  });

  it("ignores a height drop while no text field is focused", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    const { result } = renderHook(() => useAppViewport());
    await settle();

    viewport.height = FULL_HEIGHT - 336;
    await settle();

    expect(result.current.keyboardOpen).toBe(false);
    expect(document.documentElement.hasAttribute("data-keyboard")).toBe(false);
  });

  it("treats pinch zoom as zoom, not as a keyboard, and freezes the geometry", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useAppViewport());
    await settle();
    input.focus();

    // Pinching shrinks the visual viewport exactly like a keyboard would.
    viewport.scale = 2.4;
    viewport.height = FULL_HEIGHT / 2.4;
    viewport.offsetTop = 120;
    await settle();

    expect(result.current.keyboardOpen).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");
    expect(document.documentElement.style.getPropertyValue("--app-viewport-top")).toBe("0px");
  });

  it("restores the previous root values on unmount", async () => {
    const { unmount } = renderHook(() => useAppViewport());
    await settle();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");

    unmount();

    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("");
  });
});
