import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it("allows safe relative paths", () => {
    expect(safeRedirect("/claim/abc")).toBe("/claim/abc");
    expect(safeRedirect("/app")).toBe("/app");
    expect(safeRedirect("/auth/onboard")).toBe("/auth/onboard");
  });

  it("returns default fallback for null/undefined/empty", () => {
    expect(safeRedirect(null)).toBe("/app");
    expect(safeRedirect(undefined)).toBe("/app");
    expect(safeRedirect("")).toBe("/app");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com")).toBe("/app");
    expect(safeRedirect("//evil.com/path")).toBe("/app");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.com")).toBe("/app");
    expect(safeRedirect("http://evil.com")).toBe("/app");
    expect(safeRedirect("javascript://x")).toBe("/app");
  });

  it("rejects backslash paths", () => {
    expect(safeRedirect("\\evil")).toBe("/app");
    expect(safeRedirect("/\\evil")).toBe("/app");
  });

  it("honors custom fallback", () => {
    expect(safeRedirect(null, "/auth")).toBe("/auth");
    expect(safeRedirect("//evil.com", "/auth")).toBe("/auth");
  });
});
