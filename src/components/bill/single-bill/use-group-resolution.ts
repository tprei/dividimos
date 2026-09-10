"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { createGroup, getOrCreateDm } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";
import type { User } from "@/types";

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

  const resolveGroup = useCallback(
    async (defaultGroupName: string): Promise<string | null | undefined> => {
      if (groupSelection && groupSelection !== "create" && groupSelection !== "dm") return groupSelection;
      const state = useBillStore.getState();
      const others = state.participants.filter((participant) => participant.id !== me.id);
      const hasGuests = state.guests.length > 0;
      const isDmCase =
        groupSelection === "dm" ||
        (groupSelection === null && others.length === 1 && !hasGuests);
      if (isDmCase) {
        if (others.length !== 1 || hasGuests) {
          toast.error("Conversa direta exige uma pessoa registrada.");
          return undefined;
        }
        if (isDmMode && initialGroupId) return initialGroupId;
        try {
          const dm = await getOrCreateDm(others[0].id);
          setGroupSelection(dm.groupId);
          setCreateGroupEnabled(false);
          return dm.groupId;
        } catch (error) {
          toast.error(ledgerErrorMessage(error));
          return undefined;
        }
      }
      const needsGroup = others.length > 0 || hasGuests;
      if (groupSelection === "create" || (groupSelection === null && needsGroup)) {
        if (!createGroupEnabled) {
          toast.error('Escolha um grupo existente ou deixe "Criar grupo" marcado.');
          return undefined;
        }
        try {
          const ack = await createGroup(
            createGroupName.trim() || defaultGroupName || "Novo grupo",
            others.map((participant) => participant.id),
          );
          setGroupSelection(ack.groupId);
          setCreateGroupEnabled(false);
          return ack.groupId;
        } catch (error) {
          toast.error(ledgerErrorMessage(error));
          return undefined;
        }
      }
      return null;
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
    resolveGroup,
  };
}
