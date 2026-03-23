"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserProfile } from "@/types";

interface RecentContactsProps {
  onSelect: (profile: UserProfile) => void;
  excludeIds: string[];
  currentUserId: string;
}

export function RecentContacts({
  onSelect,
  excludeIds,
  currentUserId,
}: RecentContactsProps) {
  const [contacts, setContacts] = useState<UserProfile[]>([]);

  useEffect(() => {
    async function fetchContacts() {
      const supabase = createClient();

      const { data: myBills } = await supabase
        .from("bill_participants")
        .select("bill_id")
        .eq("user_id", currentUserId);

      if (!myBills || myBills.length === 0) return;

      const billIds = myBills.map((b) => b.bill_id);

      const { data: coParticipants } = await supabase
        .from("bill_participants")
        .select("user_id")
        .in("bill_id", billIds)
        .neq("user_id", currentUserId);

      if (!coParticipants || coParticipants.length === 0) return;

      const seen = new Set<string>();
      const contactUserIds: string[] = [];
      for (const row of coParticipants) {
        if (!seen.has(row.user_id)) {
          seen.add(row.user_id);
          contactUserIds.push(row.user_id);
          if (contactUserIds.length >= 10) break;
        }
      }

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("*")
        .in("id", contactUserIds);

      if (!profiles) return;

      setContacts(
        profiles.map((p) => ({
          id: p.id,
          handle: p.handle,
          name: p.name,
          avatarUrl: p.avatar_url ?? undefined,
        })),
      );
    }

    fetchContacts();
  }, [currentUserId]);

  const visible = contacts.filter((c) => !excludeIds.includes(c.id));

  if (visible.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Contatos recentes
      </p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {visible.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => onSelect(contact)}
            className="flex flex-col items-center gap-1 rounded-xl p-2 transition-colors hover:bg-muted"
          >
            <UserAvatar name={contact.name} avatarUrl={contact.avatarUrl} size="sm" />
            <span className="text-[10px] text-muted-foreground max-w-[48px] truncate">
              {contact.name.split(" ")[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
