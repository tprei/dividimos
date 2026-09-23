import type { GroupSnapshot } from "@/types/ledger";

/**
 * Display name for a group. A DM is shown as the counterparty's name, because
 * "conversa com Ana" is what the user calls it, not the stored group name.
 */
export function getGroupName(
  groupId: string,
  groups: Record<string, GroupSnapshot>,
  meId: string | undefined,
): string {
  const snapshot = groups[groupId];
  if (!snapshot) return "Grupo";
  if (snapshot.group.kind === "dm") {
    const counterparty = snapshot.members.find((m) => m.user.id !== meId);
    return counterparty?.user.name ?? snapshot.group.name;
  }
  return snapshot.group.name;
}

/**
 * Resolver from a participant id to the name event copy should use. Members
 * and guests of the event's own group win; other groups are a fallback for
 * actors who have since left. Self resolves to the mid-sentence "você";
 * callers capitalize it with sentenceStart where it opens a sentence.
 */
export function makeNameOf(
  groupId: string,
  groups: Record<string, GroupSnapshot>,
  meId: string | undefined,
): (userId: string) => string {
  return (userId: string) => {
    if (userId && userId === meId) return "você";
    const currentGroup = groups[groupId];
    if (currentGroup) {
      const member = currentGroup.members.find((m) => m.user.id === userId);
      if (member) return member.user.name;
      const guest = currentGroup.guests.find((g) => g.id === userId);
      if (guest) return guest.displayName;
    }
    for (const group of Object.values(groups)) {
      const member = group.members.find((m) => m.user.id === userId);
      if (member) return member.user.name;
      const guest = group.guests.find((g) => g.id === userId);
      if (guest) return guest.displayName;
    }
    return "alguém";
  };
}
