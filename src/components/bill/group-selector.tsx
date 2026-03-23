"use client";

import { useEffect, useState } from "react";
import { Users, X, ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserProfile } from "@/types";

interface GroupEntry {
  id: string;
  name: string;
  members: UserProfile[];
  addableCount: number;
  hasPendingInvites: boolean;
}

interface GroupSelectorProps {
  currentUserId: string;
  excludeIds: string[];
  onSelectGroup: (groupId: string, groupName: string, members: UserProfile[]) => void;
  onDeselectGroup: () => void;
  selectedGroupId: string | null;
  selectedGroupName: string | null;
}

export function GroupSelector({
  currentUserId,
  excludeIds,
  onSelectGroup,
  onDeselectGroup,
  selectedGroupId,
  selectedGroupName,
}: GroupSelectorProps) {
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchGroups() {
      setLoading(true);
      const supabase = createClient();

      const { data: memberRows } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", currentUserId)
        .eq("status", "accepted");

      const { data: createdGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("creator_id", currentUserId);

      const memberGroupIds = (memberRows ?? []).map((r) => r.group_id);
      const createdGroupIds = (createdGroups ?? []).map((g) => g.id);
      const allGroupIds = [...new Set([...memberGroupIds, ...createdGroupIds])];

      if (allGroupIds.length === 0) {
        setGroups([]);
        setLoading(false);
        return;
      }

      const { data: allGroups } = await supabase
        .from("groups")
        .select("id, name")
        .in("id", allGroupIds);

      const entries: GroupEntry[] = [];

      for (const group of allGroups ?? []) {
        const { data: allMembers } = await supabase
          .from("group_members")
          .select("user_id, status")
          .eq("group_id", group.id);

        const acceptedIds = (allMembers ?? []).filter((m) => m.status === "accepted").map((m) => m.user_id);
        const hasPendingInvites = (allMembers ?? []).some((m) => m.status === "invited");

        const { data: creatorRow } = await supabase
          .from("groups")
          .select("creator_id")
          .eq("id", group.id)
          .single();

        const allMemberIds = [...new Set([...acceptedIds, creatorRow?.creator_id].filter(Boolean))] as string[];
        const addableMemberIds = allMemberIds.filter((id) => id !== currentUserId && !excludeIds.includes(id));

        if (addableMemberIds.length === 0 && !hasPendingInvites) {
          continue;
        }

        let memberProfiles: UserProfile[] = [];
        if (addableMemberIds.length > 0) {
          const { data: profiles } = await supabase
            .from("user_profiles")
            .select("id, handle, name, avatar_url")
            .in("id", addableMemberIds);

          memberProfiles = (profiles ?? []).map((p) => ({
            id: p.id,
            handle: p.handle ?? "",
            name: p.name,
            avatarUrl: p.avatar_url ?? undefined,
          }));
        }

        entries.push({
          id: group.id,
          name: group.name,
          members: memberProfiles,
          addableCount: addableMemberIds.length,
          hasPendingInvites,
        });
      }

      setGroups(entries);
      setLoading(false);
    }

    fetchGroups();
  }, [currentUserId, excludeIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selectedGroupId) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Grupo selecionado</p>
            <p className="font-medium text-sm">{selectedGroupName}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeselectGroup}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="w-full justify-between"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Selecionar grupo
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {open && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          {groups.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {loading ? "Carregando grupos..." : "Nenhum grupo disponível"}
            </p>
          ) : (
            <div className="divide-y">
              {groups.map((group) => {
                const disabled = group.hasPendingInvites || group.addableCount === 0;
                return (
                  <button
                    key={group.id}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                      disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50"
                    }`}
                    disabled={disabled}
                    onClick={() => {
                      onSelectGroup(group.id, group.name, group.members);
                      setOpen(false);
                    }}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{group.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.hasPendingInvites
                          ? "Membros com convite pendente"
                          : group.addableCount === 0
                            ? "Todos ja adicionados"
                            : `${group.addableCount} ${group.addableCount === 1 ? "pessoa" : "pessoas"} para adicionar`}
                      </p>
                    </div>
                    <div className="flex -space-x-1.5">
                      {group.members.slice(0, 3).map((m) => (
                        <UserAvatar key={m.id} name={m.name} avatarUrl={m.avatarUrl} size="xs" />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
