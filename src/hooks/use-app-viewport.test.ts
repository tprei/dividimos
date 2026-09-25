import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppViewport } from "./use-app-viewport";
const native = vi.hoisted(() => ({ enabled: false }));
const keyboardListeners = vi.hoisted(() => new Map<string, (info: { keyboardHeight: number }) => void>());
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn(async (event: string, listener: (info: { keyboardHeight: number }) => void) => {
      keyboardListeners.set(event, listener);
      return { remove: async () => { keyboardListeners.delete(event); } };
    }),
  },
}));

vi.mock("@/lib/capacitor/auth", () => ({
  isNativePlatform: () => native.enabled,
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
  native.enabled = false;
  keyboardListeners.clear();
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
  it("publishes native keyboard height without shrinking geometry twice", async () => {
    native.enabled = true;
    const { result } = renderHook(() => useAppViewport());
    await settle();
    await act(async () => keyboardListeners.get("keyboardWillShow")?.({ keyboardHeight: 336 }));
    expect(result.current.keyboardOpen).toBe(true);
    viewport.height = 508;
    await settle();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("508px");
    await act(async () => keyboardListeners.get("keyboardWillHide")?.({ keyboardHeight: 0 }));
    expect(result.current.keyboardOpen).toBe(false);
  });
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
    input.blur();
    await settle();
    viewport.height = FULL_HEIGHT;
    await settle();
    expect(result.current.keyboardOpen).toBe(false);
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
  it("keeps geometry when a nested instance unmounts after keyboard closes", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const shell = renderHook(() => useAppViewport());
    await settle();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");

    input.focus();
    viewport.height = FULL_HEIGHT - 336;
    await settle();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("508px");

    const sheet = renderHook(() => useAppViewport());
    await settle();

    input.blur();
    viewport.height = FULL_HEIGHT;
    await settle();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");

    sheet.unmount();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("844px");

    shell.unmount();
    expect(document.documentElement.style.getPropertyValue("--app-viewport-height")).toBe("");
  });
});
