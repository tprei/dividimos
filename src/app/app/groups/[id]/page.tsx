"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Clock,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { GroupMemberStatus, UserProfile } from "@/types";

interface MemberEntry {
  userId: string;
  status: GroupMemberStatus;
  profile: UserProfile;
  invitedBy: string;
}

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const [groupName, setGroupName] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [lookupResult, setLookupResult] = useState<UserProfile | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [searching, setSearching] = useState(false);

  const supabase = createClient();

  async function fetchGroup() {
    const { data: group } = await supabase
      .from("groups")
      .select("name, creator_id")
      .eq("id", id)
      .single();

    if (!group) return;

    setGroupName(group.name);
    setCreatorId(group.creator_id);

    const { data: groupMembers } = await supabase
      .from("group_members")
      .select("user_id, status, invited_by")
      .eq("group_id", id);

    const entries: MemberEntry[] = [];

    const creatorProfile = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", group.creator_id)
      .single();

    if (creatorProfile.data) {
      entries.push({
        userId: group.creator_id,
        status: "accepted",
        profile: {
          id: creatorProfile.data.id,
          handle: creatorProfile.data.handle,
          name: creatorProfile.data.name,
          avatarUrl: creatorProfile.data.avatar_url ?? undefined,
        },
        invitedBy: group.creator_id,
      });
    }

    for (const m of groupMembers ?? []) {
      if (m.user_id === group.creator_id) continue;

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", m.user_id)
        .single();

      if (profile) {
        entries.push({
          userId: m.user_id,
          status: m.status as GroupMemberStatus,
          profile: {
            id: profile.id,
            handle: profile.handle,
            name: profile.name,
            avatarUrl: profile.avatar_url ?? undefined,
          },
          invitedBy: m.invited_by,
        });
      }
    }

    setMembers(entries);
    setLoading(false);
  }

  useEffect(() => {
    fetchGroup();
  }, [id]);

  const isCreator = user?.id === creatorId;
  const isAcceptedMember = members.some(
    (m) => m.userId === user?.id && m.status === "accepted",
  );
  const canInvite = isCreator || isAcceptedMember;

  const handleLookup = async () => {
    const handle = handleInput.toLowerCase().replace(/^@/, "").trim();
    if (!handle) return;

    setSearching(true);
    setLookupResult(null);
    setLookupError("");

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("handle", handle)
      .single();

    if (!profile) {
      setLookupError(`Nenhum usuario encontrado com @${handle}`);
    } else if (members.some((m) => m.userId === profile.id)) {
      setLookupError("Ja esta no grupo");
    } else {
      setLookupResult({
        id: profile.id,
        handle: profile.handle,
        name: profile.name,
        avatarUrl: profile.avatar_url ?? undefined,
      });
    }
    setSearching(false);
  };

  const handleInvite = async () => {
    if (!lookupResult || !user) return;

    const { error } = await supabase.from("group_members").insert({
      group_id: id,
      user_id: lookupResult.id,
      invited_by: user.id,
      status: "invited" as GroupMemberStatus,
    });

    if (error) {
      toast.error("Erro ao convidar");
      return;
    }

    toast.success(`Convite enviado para @${lookupResult.handle}`);
    setLookupResult(null);
    setHandleInput("");
    setShowInvite(false);
    await fetchGroup();
  };

  const handleRemoveMember = async (userId: string) => {
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", id)
      .eq("user_id", userId);
    await fetchGroup();
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app/groups"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold">{groupName}</h1>
          <p className="text-xs text-muted-foreground">
            {members.length} membro{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        {canInvite && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setShowInvite(!showInvite)}
          >
            <UserPlus className="h-4 w-4" />
            Convidar
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden rounded-2xl border bg-card p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Convidar por @handle</span>
              <button
                onClick={() => {
                  setShowInvite(false);
                  setLookupResult(null);
                  setLookupError("");
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  @
                </span>
                <Input
                  className="pl-7"
                  placeholder="handle do usuario"
                  value={handleInput}
                  onChange={(e) => {
                    setHandleInput(e.target.value);
                    setLookupResult(null);
                    setLookupError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleLookup}
                disabled={!handleInput.trim() || searching}
                className="shrink-0"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {lookupError && (
              <p className="mt-2 text-xs text-destructive">{lookupError}</p>
            )}

            {lookupResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3"
              >
                <UserAvatar
                  name={lookupResult.name}
                  avatarUrl={lookupResult.avatarUrl}
                  size="sm"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{lookupResult.name}</p>
                  <p className="text-xs text-muted-foreground">
                    @{lookupResult.handle}
                  </p>
                </div>
                <Button size="sm" className="gap-1" onClick={handleInvite}>
                  <UserPlus className="h-3.5 w-3.5" />
                  Convidar
                </Button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 space-y-2">
        {members.map((member) => (
          <motion.div
            key={member.userId}
            layout
            className="flex items-center gap-3 rounded-xl border bg-card p-3"
          >
            <UserAvatar
              name={member.profile.name}
              avatarUrl={member.profile.avatarUrl}
              size="sm"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{member.profile.name}</p>
                {member.userId === creatorId && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Criador
                  </span>
                )}
                {member.userId === user?.id && member.userId !== creatorId && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Voce
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-muted-foreground">
                  @{member.profile.handle}
                </p>
                {member.status === "invited" && (
                  <span className="flex items-center gap-0.5 text-[10px] text-warning-foreground">
                    <Clock className="h-3 w-3" />
                    Pendente
                  </span>
                )}
                {member.status === "accepted" && member.userId !== creatorId && (
                  <span className="flex items-center gap-0.5 text-[10px] text-success">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            </div>
            {isCreator && member.userId !== creatorId && (
              <button
                onClick={() => handleRemoveMember(member.userId)}
                className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
