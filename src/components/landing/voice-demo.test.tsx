import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import * as framerMotion from "framer-motion";
import { VoiceDemo } from "./voice-demo";

describe("VoiceDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(false);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("progresses phrase words on 100ms ticks and completes with amount and share", () => {
    const { getByRole, getByText } = render(<VoiceDemo />);
    const mic = getByRole("button", { name: "Falar uma despesa" });

    expect(getByText(/mercado 86 reais, divide com a Carla/)).toBeDefined();

    act(() => {
      fireEvent.click(mic);
    });

    expect(mic.getAttribute("aria-pressed")).toBe("true");
    expect(getByText(/“uber…/)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    expect(getByText(/“uber 32…/)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1800);
    });

    expect(mic.getAttribute("aria-pressed")).toBe("false");
    expect(getByText(/“uber 32 reais com o Bruno”/)).toBeDefined();
    expect(getByText(/32,00/)).toBeDefined();
    expect(getByText(/16,00/)).toBeDefined();
  });

  it("stops early on second click and completes draft immediately", () => {
    const { getByRole, getByText } = render(<VoiceDemo />);
    const mic = getByRole("button", { name: "Falar uma despesa" });

    act(() => {
      fireEvent.click(mic);
    });
    expect(mic.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      fireEvent.click(mic);
    });

    expect(mic.getAttribute("aria-pressed")).toBe("false");
    expect(getByText(/“uber 32 reais com o Bruno”/)).toBeDefined();
    expect(getByText(/32,00/)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
    expect(getByText(/“uber 32 reais com o Bruno”/)).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes immediately when reduced motion is preferred", () => {
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(true);
    const { getByRole, getByText } = render(<VoiceDemo />);
    const mic = getByRole("button", { name: "Falar uma despesa" });

    act(() => {
      fireEvent.click(mic);
    });

    expect(mic.getAttribute("aria-pressed")).toBe("false");
    expect(getByText(/“uber 32 reais com o Bruno”/)).toBeDefined();
    expect(getByText(/32,00/)).toBeDefined();
  });

  it("cleans up timer on unmount during active recording", () => {
    const { getByRole, unmount } = render(<VoiceDemo />);
    const mic = getByRole("button", { name: "Falar uma despesa" });

    act(() => {
      fireEvent.click(mic);
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
