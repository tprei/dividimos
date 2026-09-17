import { describe, expect, it } from "vitest";
import { parseInvitePreview } from "./invite-preview";

describe("parseInvitePreview", () => {
  it("parses a valid preview", () => {
    expect(
      parseInvitePreview({ groupName: "Praia", memberCount: 3, creatorName: "Ana", valid: true }),
    ).toEqual({ groupName: "Praia", memberCount: 3, creatorName: "Ana", valid: true });
  });

  it("treats a malformed or explicitly invalid payload as not valid", () => {
    expect(parseInvitePreview(null)).toBeNull();
    expect(parseInvitePreview("x")).toBeNull();
    expect(parseInvitePreview({ valid: "yes" })?.valid).toBe(false);
  });
});
