"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { getOrCreateDm } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import type { User } from "@/types";

/**
 * Where this bill should live, decided but not yet written.
 *
 * A new group is described rather than created so the submit can write the
 * group and the bill in one transaction.
 */
export type GroupPlan =
  | { kind: "existing"; groupId: string }
  | { kind: "create"; name: string; memberIds: string[] }
  | { kind: "none" }
  | { kind: "invalid" };

export function profileToUser(profile: UserProfile): User {
  return {
    id: profile.id,
    email: "",
    handle: profile.handle,
    name: profile.name,
    pixKeyType: "email",
    pixKeyHint: "",
    avatarUrl: profile.avatarUrl ?? undefined,
    onboarded: true,
    createdAt: "",
  };
}

export function useGroupResolution({
  me,
  groups,
  initialGroupId,
  isDmMode,
}: {
  me: Me;
  groups: GroupSnapshot[];
  initialGroupId: string | null;
  isDmMode: boolean;
}) {
  const [groupSelection, setGroupSelection] = useState<string | null>(() =>
    isDmMode ? "dm" : initialGroupId,
  );
  const [seenInitialGroupId, setSeenInitialGroupId] = useState(initialGroupId);
  if (initialGroupId !== seenInitialGroupId) {
    setSeenInitialGroupId(initialGroupId);
    if (initialGroupId && !isDmMode && (groupSelection === null || groupSelection === seenInitialGroupId)) {
      setGroupSelection(initialGroupId);
    }
  }
  const [createGroupEnabled, setCreateGroupEnabled] = useState(!isDmMode);
  const [createGroupName, setCreateGroupName] = useState("");

  const handleGroupSelect = useCallback(
    (value: string | null) => {
      setGroupSelection(value);
      setCreateGroupEnabled(value === "create" || value === null);
      if (value === "create" || value === "dm") return;
      const billStore = useBillStore.getState();
      for (const participant of billStore.participants) {
        if (participant.id !== me.id) billStore.removeParticipant(participant.id);
      }
      if (!value) return;
      const group = groups.find((snapshot) => snapshot.group.id === value);
      if (!group) return;
      for (const member of group.members) {
        if (member.userId === me.id || member.status !== "accepted") continue;
        billStore.addParticipant(profileToUser(member.user));
      }
    },
    [groups, me.id],
  );

  const planGroup = useCallback(
    async (defaultGroupName: string): Promise<GroupPlan> => {
      if (groupSelection && groupSelection !== "create" && groupSelection !== "dm") {
        return { kind: "existing", groupId: groupSelection };
      }
      const state = useBillStore.getState();
      const others = state.participants.filter((participant) => participant.id !== me.id);
      const hasGuests = state.guests.length > 0;
      const isDmCase =
        groupSelection === "dm" ||
        (groupSelection === null && others.length === 1 && !hasGuests);
      if (isDmCase) {
        if (others.length !== 1 || hasGuests) {
          toast.error("Conversa direta exige uma pessoa registrada.");
          return { kind: "invalid" };
        }
        if (isDmMode && initialGroupId) return { kind: "existing", groupId: initialGroupId };
        try {
          const dm = await getOrCreateDm(others[0].id);
          setGroupSelection(dm.groupId);
          setCreateGroupEnabled(false);
          return { kind: "existing", groupId: dm.groupId };
        } catch (error) {
          toast.error(ledgerErrorMessage(error));
          return { kind: "invalid" };
        }
      }
      const needsGroup = others.length > 0 || hasGuests;
      if (groupSelection === "create" || (groupSelection === null && needsGroup)) {
        if (!createGroupEnabled) {
          toast.error('Escolha um grupo existente ou deixe "Criar grupo" marcado.');
          return { kind: "invalid" };
        }
        // Nothing is created here. The group is born with the bill in one
        // transaction, so abandoning or failing the submit leaves nothing.
        return {
          kind: "create",
          name: createGroupName.trim() || defaultGroupName || "Novo grupo",
          memberIds: others.map((participant) => participant.id),
        };
      }
      return { kind: "none" };
    },
    [createGroupEnabled, createGroupName, groupSelection, initialGroupId, isDmMode, me.id],
  );

  return {
    groupSelection,
    createGroupName,
    createGroupEnabled,
    setCreateGroupName,
    setCreateGroupEnabled,
    handleGroupSelect,
    planGroup,
    setGroupSelection,
  };
}
