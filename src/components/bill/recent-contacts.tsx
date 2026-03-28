"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserProfile } from "@/types";
import type { Database } from "@/types/database";

type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

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

      // Find expenses where current user has a share or is a payer
      const [{ data: myShares }, { data: myPayments }] = await Promise.all([
        supabase
          .from("expense_shares")
          .select("expense_id")
          .eq("user_id", currentUserId),
        supabase
          .from("expense_payers")
          .select("expense_id")
          .eq("user_id", currentUserId),
      ]);

      const expenseIds = [
        ...new Set([
          ...(myShares ?? []).map((s) => s.expense_id),
          ...(myPayments ?? []).map((p) => p.expense_id),
        ]),
      ];

      if (expenseIds.length === 0) return;

      // Find other users who participated in those expenses
      const [{ data: coSharers }, { data: coPayers }] = await Promise.all([
        supabase
          .from("expense_shares")
          .select("user_id")
          .in("expense_id", expenseIds)
          .neq("user_id", currentUserId),
        supabase
          .from("expense_payers")
          .select("user_id")
          .in("expense_id", expenseIds)
          .neq("user_id", currentUserId),
      ]);

      const coParticipants = [
        ...(coSharers ?? []),
        ...(coPayers ?? []),
      ];

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
        (profiles as UserProfileRow[]).map((p) => ({
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
