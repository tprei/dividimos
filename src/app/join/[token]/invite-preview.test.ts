import { describe, expect, it } from "vitest";
import { inviteInvalidMessage, inviteReasonKind, parseInvitePreview } from "./invite-preview";

describe("parseInvitePreview", () => {
  it("parses a valid preview with a reason", () => {
    expect(
      parseInvitePreview({ groupName: "Praia", memberCount: 3, creatorName: "Ana", valid: true, reason: null }),
    ).toEqual({ groupName: "Praia", memberCount: 3, creatorName: "Ana", valid: true, reason: null });
  });

  it("returns null for non-objects", () => {
    expect(parseInvitePreview(null)).toBeNull();
    expect(parseInvitePreview("x")).toBeNull();
  });

  it("defaults a missing reason to invalid", () => {
    expect(inviteReasonKind({ groupName: null, memberCount: null, creatorName: null, valid: false, reason: null })).toBe("invalid");
    expect(inviteInvalidMessage("invalid")).toBe("Este convite não é mais válido.");
  });

  it("maps reason codes to PT-BR messages", () => {
    expect(inviteInvalidMessage(inviteReasonKind({ groupName: null, memberCount: null, creatorName: null, valid: false, reason: "link_expired" }))).toBe("Este convite expirou.");
    expect(inviteInvalidMessage(inviteReasonKind({ groupName: null, memberCount: null, creatorName: null, valid: false, reason: "link_inactive" }))).toBe("Este convite foi desativado.");
    expect(inviteInvalidMessage(inviteReasonKind({ groupName: null, memberCount: null, creatorName: null, valid: false, reason: "link_exhausted" }))).toBe("Este convite atingiu o limite de usos.");
  });
});
