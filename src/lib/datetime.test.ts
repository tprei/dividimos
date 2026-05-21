import { describe, it, expect } from "vitest";
import { formatBrazilianDate } from "./datetime";

describe("formatBrazilianDate", () => {
  it("renders the calendar day in Brazil time, not the server's UTC day", () => {
    // 01:00 UTC on Apr 11 is 22:00 BRT on Apr 10 — must show Apr 10.
    expect(formatBrazilianDate("2026-04-11T01:00:00Z")).toMatch(/^10 de abr/);
  });

  it("renders the same calendar day when UTC and BR agree", () => {
    // 10:00 UTC on Apr 11 is 07:00 BRT on Apr 11.
    expect(formatBrazilianDate("2026-04-11T10:00:00Z")).toMatch(/^11 de abr/);
  });

  it("is independent of the test runner's local timezone", () => {
    // Both assertions above hold regardless of process TZ because the formatter
    // pins the timezone explicitly; this case crosses midnight the other way.
    // 02:30 UTC on Jan 1 is 23:30 BRT on Dec 31 of the prior year.
    expect(formatBrazilianDate("2026-01-01T02:30:00Z")).toMatch(/^31 de dez.* 2025$/);
  });

  it("honors custom Intl options", () => {
    const out = formatBrazilianDate("2026-04-11T10:00:00Z", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    expect(out).toBe("11/04/2026");
  });
});
