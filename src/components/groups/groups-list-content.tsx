"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/use-auth";
import type { GroupMemberStatus, UserProfile } from "@/types";

interface GroupEntry {
  id: string;
  name: string;
  creatorId: string;
  memberCount: number;
  members: UserProfile[];
  activeBillCount: number;
}

interface PendingInvite {
  groupId: string;
  groupName: string;
  invitedByName: string;
}

interface GroupsListContentProps {
  initialGroups: GroupEntry[];
  initialInvites: PendingInvite[];
}

export function GroupsListContent({ initialGroups, initialInvites }: GroupsListContentProps) {
  const user = useUser();
  const [groups, setGroups] = useState<GroupEntry[]>(initialGroups);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const refetch = async () => {
    if (!user) return;
    const supabase = createClient();

    const [{ data: myMemberships }, { data: createdGroups }] = await Promise.all([
      supabase.from("group_members").select("group_id, status, invited_by").eq("user_id", user.id),
      supabase.from("groups").select("id").eq("creator_id", user.id),
    ]);

    const allGroupIds = new Set<string>();
    const pendingGroupIds: string[] = [];

    for (const m of myMemberships ?? []) {
      allGroupIds.add(m.group_id);
      if (m.status === "invited") pendingGroupIds.push(m.group_id);
    }
    for (const g of createdGroups ?? []) {
      allGroupIds.add(g.id);
    }

    if (allGroupIds.size === 0) {
      setGroups([]);
      setInvites([]);
      return;
    }

    const groupIdArray = Array.from(allGroupIds);
    const nonPendingGroupIds = groupIdArray.filter((id) => !pendingGroupIds.includes(id));

    const [{ data: groupData }, { data: allMembers }, { data: activeBillRows }] = await Promise.all([
      supabase.from("groups").select("id, name, creator_id").in("id", groupIdArray),
      supabase.from("group_members").select("group_id, user_id").in("group_id", groupIdArray).eq("status", "accepted"),
      nonPendingGroupIds.length > 0
        ? supabase.from("bills").select("group_id").in("group_id", nonPendingGroupIds).neq("status", "settled")
        : Promise.resolve({ data: [] }),
    ]);

    const membersByGroup = new Map<string, string[]>();
    for (const m of allMembers ?? []) {
      const list = membersByGroup.get(m.group_id) ?? [];
      list.push(m.user_id);
      membersByGroup.set(m.group_id, list);
    }

    const billCountByGroup = new Map<string, number>();
    for (const b of (activeBillRows as { group_id: string }[] | null) ?? []) {
      billCountByGroup.set(b.group_id, (billCountByGroup.get(b.group_id) ?? 0) + 1);
    }

    const allMemberIds = [...new Set((allMembers ?? []).map((m) => m.user_id))];
    const { data: profiles } = allMemberIds.length > 0
      ? await supabase.from("user_profiles").select("id, handle, name, avatar_url").in("id", allMemberIds)
      : { data: [] };

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const entries: GroupEntry[] = [];
    for (const g of groupData ?? []) {
      if (pendingGroupIds.includes(g.id)) continue;
      const memberIds = membersByGroup.get(g.id) ?? [];
      const memberProfiles: UserProfile[] = memberIds.slice(0, 5).flatMap((id) => {
        const p = profileMap.get(id);
        return p ? [{ id: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatar_url ?? undefined }] : [];
      });
      entries.push({
        id: g.id,
        name: g.name,
        creatorId: g.creator_id,
        memberCount: memberIds.length + 1,
        members: memberProfiles,
        activeBillCount: billCountByGroup.get(g.id) ?? 0,
      });
    }

    const pendingInviteUserIds: string[] = [];
    const pendingInviteByGroupMap = new Map<string, string>();
    for (const membership of myMemberships ?? []) {
      if (pendingGroupIds.includes(membership.group_id)) {
        const inviterRef = membership.invited_by;
        if (inviterRef) {
          pendingInviteByGroupMap.set(membership.group_id, inviterRef);
          pendingInviteUserIds.push(inviterRef);
        }
      }
    }

    const { data: inviterProfiles } = pendingInviteUserIds.length > 0
      ? await supabase.from("user_profiles").select("id, name").in("id", pendingInviteUserIds)
      : { data: [] };

    const inviterNameMap = new Map((inviterProfiles ?? []).map((p) => [p.id, p.name]));

    const pendingInvites: PendingInvite[] = pendingGroupIds.flatMap((gid) => {
      const group = (groupData ?? []).find((g) => g.id === gid);
      if (!group) return [];
      const inviterId = pendingInviteByGroupMap.get(gid) ?? "";
      return [{ groupId: gid, groupName: group.name, invitedByName: inviterNameMap.get(inviterId) ?? "" }];
    });

    setGroups(entries);
    setInvites(pendingInvites);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !user) return;
    setCreating(true);
    const { error } = await createClient().from("groups").insert({
      name: newGroupName.trim(),
      creator_id: user.id,
    });
    if (!error) {
      setNewGroupName("");
      setShowCreate(false);
      await refetch();
    }
    setCreating(false);
  };

  const handleAcceptInvite = async (groupId: string) => {
    if (!user) return;
    await createClient()
      .from("group_members")
      .update({ status: "accepted" as GroupMemberStatus, accepted_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    await refetch();
  };

  const handleDeclineInvite = async (groupId: string) => {
    if (!user) return;
    await createClient()
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
    await refetch();
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold">Grupos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {groups.length} grupo{groups.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Novo
        </Button>
      </motion.div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden rounded-2xl border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Novo grupo</span>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Input
              className="mt-3"
              placeholder="Nome do grupo"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            />
            <Button
              className="mt-3 w-full"
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || creating}
            >
              Criar grupo
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {invites.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4 }}
          className="mt-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Convites pendentes</h2>
          </div>
          <div className="space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.groupId}
                className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-4"
              >
                <div>
                  <p className="font-medium">{invite.groupName}</p>
                  <p className="text-xs text-muted-foreground">
                    Convidado por {invite.invitedByName}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    onClick={() => handleDeclineInvite(invite.groupId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => handleAcceptInvite(invite.groupId)}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aceitar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6 space-y-3"
      >
        {groups.map((group) => (
          <motion.div key={group.id} variants={staggerItem}>
            <Link href={`/app/groups/${group.id}`}>
              <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{group.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {group.memberCount} membro{group.memberCount !== 1 ? "s" : ""}
                    {group.activeBillCount > 0
                      ? ` · ${group.activeBillCount} conta${group.activeBillCount !== 1 ? "s" : ""} ativa${group.activeBillCount !== 1 ? "s" : ""}`
                      : " · Nenhuma conta"}
                  </p>
                </div>
                <div className="flex -space-x-2">
                  {group.members.slice(0, 3).map((m) => (
                    <UserAvatar
                      key={m.id}
                      name={m.name}
                      avatarUrl={m.avatarUrl}
                      size="xs"
                      className="ring-2 ring-card"
                    />
                  ))}
                  {group.memberCount > 3 && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-bold ring-2 ring-card">
                      +{group.memberCount - 3}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          </motion.div>
        ))}

        {groups.length === 0 && invites.length === 0 && (
          <EmptyState
            icon={Users}
            title="Nenhum grupo"
            description="Crie um grupo para adicionar amigos e dividir contas mais rapido."
            actionLabel="Criar grupo"
            onAction={() => setShowCreate(true)}
          />
        )}
      </motion.div>
    </div>
  );
}
