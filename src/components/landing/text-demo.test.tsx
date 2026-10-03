import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import * as framerMotion from "framer-motion";
import { TextDemo } from "./text-demo";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;
let lastObserverCallback: ObserverCallback | null = null;

const originalMatchMedia = window.matchMedia.bind(window);

function stubMedia(matchesDesktop: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const media = originalMatchMedia(query);
    const matches =
      query ===
      "(min-width: 760px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
        ? matchesDesktop
        : false;
    Object.defineProperty(media, "matches", {
      value: matches,
      configurable: true,
    });
    return media;
  });
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });
}

describe("TextDemo", () => {
  const originalIntersectionObserver = window.IntersectionObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(false);
    lastObserverCallback = null;

    class FakeIntersectionObserver {
      constructor(callback: ObserverCallback) {
        lastObserverCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.IntersectionObserver = originalIntersectionObserver;
    setDocumentHidden(false);
    vi.restoreAllMocks();
  });

  it("handles mobile manual text input and finalizes reply even when hidden", () => {
    stubMedia(false);
    const { getByPlaceholderText, getByRole, getByText } = render(
      <article>
        <TextDemo />
      </article>,
    );
    const input = getByPlaceholderText("pizza 90 em 3");
    const sendButton = getByRole("button", { name: "Enviar" });

    act(() => {
      fireEvent.change(input, { target: { value: "lanche 60 em 2" } });
    });

    act(() => {
      fireEvent.click(sendButton);
    });

    expect(getByText("lanche 60 em 2")).toBeDefined();

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      vi.advanceTimersByTime(750);
    });

    expect(getByText(/60,00/)).toBeDefined();
    expect(getByText(/30,00/)).toBeDefined();
  });

  it("gates desktop autoplay and stops permanently once user interacts", () => {
    stubMedia(true);
    const { getByPlaceholderText } = render(
      <article>
        <TextDemo />
      </article>,
    );
    const input = getByPlaceholderText("pizza 90 em 3") as HTMLInputElement;

    act(() => {
      lastObserverCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
    });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(input.value.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "uber 20" } });
    });

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(5000);
    });

    expect(input.value).toBe("uber 20");
  });
});
