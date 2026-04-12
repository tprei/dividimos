import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatDateSeparator, shouldShowDateSeparator } from "./chat-date-separator";

describe("ChatDateSeparator", () => {
  it("renders 'Hoje' for today's date", () => {
    const today = new Date().toISOString();
    render(<ChatDateSeparator date={today} />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("renders 'Ontem' for yesterday's date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    render(<ChatDateSeparator date={yesterday.toISOString()} />);
    expect(screen.getByText("Ontem")).toBeInTheDocument();
  });

  it("renders formatted date for older dates", () => {
    render(<ChatDateSeparator date="2026-01-15T12:00:00Z" />);
    expect(screen.getByText(/15/)).toBeInTheDocument();
    expect(screen.getByText(/janeiro/)).toBeInTheDocument();
  });
});

describe("shouldShowDateSeparator", () => {
  it("returns true when previousDate is undefined", () => {
    expect(shouldShowDateSeparator("2026-04-10T10:00:00Z", undefined)).toBe(true);
  });

  it("returns false for same calendar day", () => {
    expect(
      shouldShowDateSeparator("2026-04-10T22:00:00Z", "2026-04-10T10:00:00Z"),
    ).toBe(false);
  });

  it("returns true for different calendar days", () => {
    expect(
      shouldShowDateSeparator("2026-04-11T10:00:00Z", "2026-04-10T23:59:00Z"),
    ).toBe(true);
  });
});
