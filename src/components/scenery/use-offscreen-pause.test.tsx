import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { useOffscreenPause } from "./use-offscreen-pause";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

let lastCallback: ObserverCallback | null = null;
let disconnectCalled = false;

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });
}

function TestFrame() {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);
  return <div ref={ref} data-testid="frame" />;
}

describe("useOffscreenPause", () => {
  const originalIntersectionObserver = window.IntersectionObserver;

  beforeEach(() => {
    lastCallback = null;
    disconnectCalled = false;

    class FakeIntersectionObserver {
      constructor(callback: ObserverCallback) {
        lastCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        disconnectCalled = true;
      }
    }

    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    setDocumentHidden(false);
  });

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver;
    setDocumentHidden(false);
    vi.restoreAllMocks();
  });

  it("sets data-paused according to intersection and document visibility precedence", () => {
    const { getByTestId, unmount } = render(<TestFrame />);
    const frame = getByTestId("frame");

    expect(lastCallback).not.toBeNull();

    act(() => {
      lastCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
    });
    expect(frame.hasAttribute("data-paused")).toBe(false);

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frame.hasAttribute("data-paused")).toBe(true);

    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frame.hasAttribute("data-paused")).toBe(false);

    act(() => {
      lastCallback!([{ isIntersecting: false } as IntersectionObserverEntry]);
    });
    expect(frame.hasAttribute("data-paused")).toBe(true);

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frame.hasAttribute("data-paused")).toBe(true);

    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frame.hasAttribute("data-paused")).toBe(true);

    unmount();
    expect(disconnectCalled).toBe(true);
  });
});
