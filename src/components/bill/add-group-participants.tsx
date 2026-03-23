"use client";

import { motion } from "framer-motion";
import { Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types";

interface GroupOption {
  id: string;
  name: string;
  members: UserProfile[];
  hasPendingInvites: boolean;
}

interface AddGroupParticipantsProps {
  onAddMembers: (profiles: UserProfile[]) => void;
  onCancel: () => void;
  excludeIds: string[];
  currentUserId: string;
}

export function AddGroupParticipants({
  onAddMembers,
  onCancel,
  excludeIds,
  currentUserId,
}: AddGroupParticipantsProps) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function fetchGroups() {
      const { data: myGroups } = await supabase
        .from("groups")
        .select("id, name");

      if (!myGroups || myGroups.length === 0) {
        setLoading(false);
        return;
      }

      const options: GroupOption[] = [];
      for (const group of myGroups) {
        const { data: members } = await supabase
          .from("group_members")
          .select("user_id, status")
          .eq("group_id", group.id);

        const acceptedIds = (members ?? [])
          .filter((m) => m.status === "accepted" && m.user_id !== currentUserId)
          .map((m) => m.user_id);
        const pendingIds = (members ?? [])
          .filter((m) => m.status === "invited" && m.user_id !== currentUserId)
          .map((m) => m.user_id);

        const allMemberIds = [...acceptedIds, ...pendingIds];
        if (allMemberIds.length === 0) continue;

        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("*")
          .in("id", acceptedIds.length > 0 ? acceptedIds : allMemberIds);

        options.push({
          id: group.id,
          name: group.name,
          members: (profiles ?? []).map((p) => ({
            id: p.id,
            handle: p.handle,
            name: p.name,
            avatarUrl: p.avatar_url ?? undefined,
          })),
          hasPendingInvites: pendingIds.length > 0,
        });
      }
      setGroups(options);
      setLoading(false);
    }

    fetchGroups();
  }, [currentUserId]);

  const handleSelect = (group: GroupOption) => {
    const newMembers = group.members.filter((m) => !excludeIds.includes(m.id));
    if (newMembers.length > 0) {
      onAddMembers(newMembers);
    }
    onCancel();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      className="overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Adicionar de um grupo</span>
        <button
          onClick={onCancel}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && groups.length === 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground py-4">
          Nenhum grupo com membros disponiveis
        </p>
      )}

      {!loading && groups.length > 0 && (
        <div className="mt-3 space-y-2">
          {groups.map((group) => {
            const addableCount = group.members.filter(
              (m) => !excludeIds.includes(m.id),
            ).length;
            return (
              <button
                key={group.id}
                onClick={() => handleSelect(group)}
                disabled={addableCount === 0 || group.hasPendingInvites}
                className="flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-3 text-left transition-colors hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.hasPendingInvites
                      ? "Um ou mais membros ainda nao aceitaram o convite"
                      : addableCount > 0
                        ? `${addableCount} membro${addableCount > 1 ? "s" : ""} para adicionar`
                        : "Todos ja adicionados"}
                  </p>
                </div>
                <div className="flex -space-x-1.5">
                  {group.members.slice(0, 3).map((m) => (
                    <UserAvatar
                      key={m.id}
                      name={m.name}
                      avatarUrl={m.avatarUrl}
                      size="xs"
                      className="ring-2 ring-card"
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
