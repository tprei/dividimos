"use client";

import { useCallback, useState } from "react";
import type { User } from "@/types";
import type { Me, UserProfile } from "@/types/ledger";
import type { Guest } from "@/stores/bill-store";
import { useBillStore } from "@/stores/bill-store";
import { useAppStore } from "@/stores/app-store";
import { meToLegacyUser } from "@/hooks/use-auth";

export interface ScanDraftContext {
  groupId: string | null;
  participants: User[];
  guests: Guest[];
}

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

interface UseScanDraftContextOptions {
  me: Me | null;
  reviewingScan: boolean;
  onSelectGroupDefault: (groupId: string | null) => void;
}

export function useScanDraftContext({
  me,
  reviewingScan,
  onSelectGroupDefault,
}: UseScanDraftContextOptions) {
  const [scanDraftContext, setScanDraftContext] = useState<ScanDraftContext | null>(null);

  const onSelectGroup = useCallback(
    (groupId: string | null) => {
      if (!reviewingScan) {
        onSelectGroupDefault(groupId);
        return;
      }
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        if (!groupId) {
          return {
            ...prev,
            groupId: null,
            participants: me ? [meToLegacyUser(me)] : [],
          };
        }
        const snapshot = useAppStore.getState().groups[groupId];
        const members = (snapshot?.members ?? [])
          .filter((m) => m.userId !== me?.id && m.status === "accepted")
          .map((m) => profileToUser(m.user));
        return {
          ...prev,
          groupId,
          participants: me ? [meToLegacyUser(me), ...members] : members,
        };
      });
    },
    [me, reviewingScan, onSelectGroupDefault],
  );

  const onAddParticipant = useCallback(
    (profile: UserProfile) => {
      if (!reviewingScan) {
        useBillStore.getState().addParticipant(profileToUser(profile));
        return;
      }
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        const u = profileToUser(profile);
        if (prev.participants.some((p) => p.id === u.id)) return prev;
        return { ...prev, participants: [...prev.participants, u] };
      });
    },
    [reviewingScan],
  );

  const onRemoveParticipant = useCallback(
    (id: string) => {
      if (!reviewingScan) {
        useBillStore.getState().removeParticipant(id);
        return;
      }
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.id !== id),
        };
      });
    },
    [reviewingScan],
  );

  const onAddGuest = useCallback(
    (name: string, phone?: string) => {
      if (!reviewingScan) {
        useBillStore.getState().addGuest(name, phone);
        return;
      }
      const id = `guest_${crypto.randomUUID()}`;
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          guests: [...prev.guests, { id, name, phone: phone || "", remoteId: null }],
        };
      });
    },
    [reviewingScan],
  );

  const onRemoveGuest = useCallback(
    (id: string) => {
      if (!reviewingScan) {
        useBillStore.getState().removeGuest(id);
        return;
      }
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          guests: prev.guests.filter((g) => g.id !== id),
        };
      });
    },
    [reviewingScan],
  );

  const addGuestContacts = useCallback(
    (contacts: Array<{ name: string; phone: string }>) => {
      if (!reviewingScan) {
        for (const c of contacts) {
          useBillStore.getState().addGuest(c.name || c.phone, c.phone);
        }
        return;
      }
      setScanDraftContext((prev) => {
        if (!prev) return prev;
        const newGuests: Guest[] = contacts.map((c) => ({
          id: `guest_${crypto.randomUUID()}`,
          name: c.name || c.phone,
          phone: c.phone,
          remoteId: null,
        }));
        return { ...prev, guests: [...prev.guests, ...newGuests] };
      });
    },
    [reviewingScan],
  );

  return {
    scanDraftContext,
    setScanDraftContext,
    onSelectGroup,
    onAddParticipant,
    onRemoveParticipant,
    onAddGuest,
    onRemoveGuest,
    addGuestContacts,
  };
}
