import type { GroupMember } from "@/types/ledger";

/**
 * A group whose members are all bots, as far as the viewer is concerned.
 *
 * The viewer is excluded from the test on purpose: a person watching the
 * troupe is a member like any other, and counting themselves would make the
 * group look human the moment they join. Invitations are ignored too, since
 * an unanswered invite says nothing about who is actually in the group.
 */
export function isBotGroup(members: GroupMember[], meId: string): boolean {
  const others = members.filter(
    (member) => member.status === "accepted" && member.userId !== meId,
  );
  return others.length > 0 && others.every((member) => member.user.isBot);
}
