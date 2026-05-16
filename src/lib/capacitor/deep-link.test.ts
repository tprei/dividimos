import { describe, expect, it } from "vitest";
import { resolveDeepLinkTarget } from "./deep-link";

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
  });

  describe("https://www.dividimos.ai", () => {
    it("resolves a /claim/ link", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/claim/abc")).toBe(
        "/claim/abc",
      );
    });

    it("resolves a /join/ link with query", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/join/tok?from=email")).toBe(
        "/join/tok?from=email",
      );
    });

    it("rejects a different host", () => {
      expect(resolveDeepLinkTarget("https://evil.com/claim/abc")).toBeNull();
    });

    it("rejects http (downgraded)", () => {
      expect(resolveDeepLinkTarget("http://www.dividimos.ai/claim/abc")).toBeNull();
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
