import { describe, expect, it } from "vitest";
import { resolveDeepLinkTarget } from "./deep-link";

const TOKEN = "gst1_" + "a".repeat(43);

describe("resolveDeepLinkTarget", () => {
  describe("dividimos:// scheme", () => {
    it("resolves a normal in-app path", () => {
      expect(resolveDeepLinkTarget("dividimos://app/groups/abc")).toBe("/groups/abc");
    });

    it("preserves search and hash", () => {
      expect(resolveDeepLinkTarget("dividimos://app/bill?id=42#summary")).toBe(
        "/bill?id=42#summary",
      );
    });

    it("falls back when path is protocol-relative (//evil)", () => {
      expect(resolveDeepLinkTarget("dividimos://x////evil.com/path")).toBe("/app");
    });

    it("falls back when path is backslash-prefixed", () => {
      expect(resolveDeepLinkTarget("dividimos://x/\\evil")).toBe("/app");
    });

    it("rejects a claim credential in the custom scheme", () => {
      expect(resolveDeepLinkTarget(`dividimos://claim#${TOKEN}`)).toBeNull();
    });
  });

  describe("https://www.dividimos.ai", () => {
    it("resolves a strict-fragment /claim link", () => {
      expect(
        resolveDeepLinkTarget(`https://www.dividimos.ai/claim#${TOKEN}`),
      ).toBe(`/claim#${TOKEN}`);
    });

    it("rejects a path-style /claim/<uuid> link", () => {
      expect(
        resolveDeepLinkTarget("https://www.dividimos.ai/claim/550e8400-e29b-41d4-a716-446655440000"),
      ).toBeNull();
    });

    it("rejects a /claim with a malformed fragment", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/claim#not-a-token")).toBeNull();
    });

    it("rejects a /claim with no fragment", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/claim")).toBeNull();
    });

    it("resolves a /join/ link with query", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/join/tok?from=email")).toBe(
        "/join/tok?from=email",
      );
    });

    it("rejects a different host", () => {
      expect(resolveDeepLinkTarget(`https://evil.com/claim#${TOKEN}`)).toBeNull();
    });

    it("rejects http (downgraded)", () => {
      expect(resolveDeepLinkTarget(`http://www.dividimos.ai/claim#${TOKEN}`)).toBeNull();
    });
  });

  describe("hostile schemes", () => {
    it("rejects javascript:", () => {
      expect(resolveDeepLinkTarget("javascript:alert(1)")).toBeNull();
    });

    it("rejects data:", () => {
      expect(resolveDeepLinkTarget("data:text/html,<script>alert(1)</script>")).toBeNull();
    });

    it("rejects file:", () => {
      expect(resolveDeepLinkTarget("file:///etc/passwd")).toBeNull();
    });

    it("rejects mailto:", () => {
      expect(resolveDeepLinkTarget("mailto:victim@example.com")).toBeNull();
    });
  });

  describe("malformed input", () => {
    it("returns null for non-URL strings", () => {
      expect(resolveDeepLinkTarget("not a url")).toBeNull();
      expect(resolveDeepLinkTarget("")).toBeNull();
    });
  });
});
