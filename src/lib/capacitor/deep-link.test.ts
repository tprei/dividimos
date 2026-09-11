import { describe, expect, it } from "vitest";
import { resolveDeepLinkTarget } from "./deep-link";

const TOKEN = "gst1_" + "a".repeat(43);
const INVITE = "550e8400-e29b-41d4-a716-446655440000";

describe("resolveDeepLinkTarget", () => {
  describe("dividimos:// scheme", () => {
    it("keeps the authority, landing on the route that exists", () => {
      // /groups/abc is not a route; the app's screens live under /app.
      expect(resolveDeepLinkTarget("dividimos://app/groups/abc")).toBe("/app/groups/abc");
    });

    it("preserves search and hash", () => {
      expect(resolveDeepLinkTarget("dividimos://app/bill?id=42#summary")).toBe(
        "/app/bill?id=42#summary",
      );
    });

    it("opens a bare authority at its own root", () => {
      expect(resolveDeepLinkTarget("dividimos://app")).toBe("/app");
    });

    it("resolves an invite through the join authority", () => {
      expect(resolveDeepLinkTarget(`dividimos://join/${INVITE}`)).toBe(`/join/${INVITE}`);
    });

    it("rejects an authority this app does not serve", () => {
      expect(resolveDeepLinkTarget("dividimos://x////evil.com/path")).toBeNull();
      expect(resolveDeepLinkTarget("dividimos://x/\\evil")).toBeNull();
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

    it("resolves a verified invite link", () => {
      expect(resolveDeepLinkTarget(`https://www.dividimos.ai/join/${INVITE}`)).toBe(
        `/join/${INVITE}`,
      );
    });

    it("rejects an invite link whose token is not an invite token", () => {
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/join/tok?from=email")).toBeNull();
      expect(resolveDeepLinkTarget("https://www.dividimos.ai/join/")).toBeNull();
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
