import { describe, expect, it } from "vitest";
import { isBotGroup } from "@/lib/bot-group";
import type { GroupMember, MemberStatus } from "@/types/ledger";

function member(
  userId: string,
  isBot: boolean,
  status: MemberStatus = "accepted",
): GroupMember {
  return {
    groupId: "g1",
    userId,
    status,
    invitedBy: null,
    acceptedAt: status === "accepted" ? "2026-09-18T00:00:00Z" : null,
    user: {
      id: userId,
      handle: userId,
      name: userId,
      avatarUrl: null,
      isBot,
    },
  };
}

describe("isBotGroup", () => {
  it("is true when every member besides the viewer is a bot", () => {
    const members = [member("me", false), member("bot_ana", true), member("bot_bruno", true)];
    expect(isBotGroup(members, "me")).toBe(true);
  });

  it("is true for a group of bots the viewer is not in", () => {
    expect(isBotGroup([member("bot_ana", true)], "me")).toBe(true);
  });

  it("is false when another human is in the group", () => {
    const members = [member("me", false), member("bot_ana", true), member("alice", false)];
    expect(isBotGroup(members, "me")).toBe(false);
  });

  it("is false when the viewer is the only member", () => {
    expect(isBotGroup([member("me", false)], "me")).toBe(false);
  });

  it("is false for an empty group", () => {
    expect(isBotGroup([], "me")).toBe(false);
  });

  it("ignores a human who was only invited", () => {
    const members = [
      member("me", false),
      member("bot_ana", true),
      member("alice", false, "invited"),
    ];
    expect(isBotGroup(members, "me")).toBe(true);
  });
});
