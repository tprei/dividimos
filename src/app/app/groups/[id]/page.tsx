"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  LogOut,
  Mic,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  Search,
  Share2,
  Wallet,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import { GroupInviteModal } from "@/components/group/group-invite-modal";
import { NotificationPrompt } from "@/components/pwa/notification-prompt";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/skeleton";
import { GroupSettlementView } from "@/components/group/group-settlement-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/currency";
import toast from "react-hot-toast";
import { notifyGroupInvite } from "@/lib/push/push-notify";
import type { ExpenseStatus, GroupMemberStatus, Settlement, User, UserProfile } from "@/types";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { useBillStore } from "@/stores/bill-store";
import type { Database } from "@/types/database";

type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

interface MemberEntry {
  userId: string;
  status: GroupMemberStatus;
  profile: UserProfile;
  invitedBy: string;
}

interface ExpenseSummaryEntry {
  id: string;
  title: string;
  totalAmount: number;
  status: ExpenseStatus;
  createdAt: string;
}

const expenseStatusConfig: Record<ExpenseStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  settled: { label: "Quitada", color: "bg-success/15 text-success" },
};

const settlementStatusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  confirmed: { label: "Confirmado", color: "bg-success/15 text-success" },
};

type Tab = "membros" | "contas" | "pagamentos" | "acerto";

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const [groupName, setGroupName] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseSummaryEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("membros");
  const [showInvite, setShowInvite] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [lookupResult, setLookupResult] = useState<UserProfile | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [searching, setSearching] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [unclaimedGuests, setUnclaimedGuests] = useState<
    { id: string; expenseId: string; displayName: string; claimToken: string; expenseTitle: string }[]
  >([]);

  const [confirmRemove, setConfirmRemove] = useState<{
    open: boolean;
    userId: string;
    name: string;
  }>({ open: false, userId: "", name: "" });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [guestShareModal, setGuestShareModal] = useState<{
    open: boolean;
    guestName: string;
    claimToken: string;
    expenseTitle: string;
  }>({ open: false, guestName: "", claimToken: "", expenseTitle: "" });
  const [inviteLinkToken, setInviteLinkToken] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [creatingInviteLink, setCreatingInviteLink] = useState(false);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [memberBalances, setMemberBalances] = useState<Map<string, number>>(new Map());
  const store = useBillStore();

  const fetchGroup = useCallback(async (userId?: string) => {
    const supabase = createClient();

    const [{ data: group }, { data: groupMembers }] = await Promise.all([
      supabase.from("groups").select("name, creator_id").eq("id", id).single(),
      supabase.from("group_members").select("user_id, status, invited_by").eq("group_id", id),
    ]);

    if (!group) return;

    setGroupName(group.name);
    setCreatorId(group.creator_id);

    const memberRows = groupMembers ?? [];
    const allUserIds = [
      ...new Set([group.creator_id, ...memberRows.map((m) => m.user_id)]),
    ];

    // Profiles depend on member IDs, but expenses/settlements/invite-links/balances
    // only need group ID (or group ID + user ID). Run them all in parallel.
    const balancePromise = userId
      ? supabase
          .from("balances")
          .select("*")
          .eq("group_id", id)
          .neq("amount_cents", 0)
          .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      : Promise.resolve({ data: null });

    const [
      { data: profiles },
      { data: expenseRows },
      { data: settlementRows },
      { data: inviteLinkRows },
      { data: balanceRows },
    ] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .in("id", allUserIds),
      supabase
        .from("expenses")
        .select("id, title, total_amount, status, created_at")
        .eq("group_id", id)
        .neq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("settlements")
        .select("id, group_id, from_user_id, to_user_id, amount_cents, status, created_at, confirmed_at")
        .eq("group_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("group_invite_links")
        .select("token")
        .eq("group_id", id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1),
      balancePromise,
    ]);

    // Guest query depends on expense IDs from the parallel batch above.
    const expenseList = expenseRows ?? [];
    const expenseIds = expenseList.map((e) => e.id);
    let guestRows: { id: string; expense_id: string; display_name: string; claim_token: string }[] = [];
    if (expenseIds.length > 0) {
      const { data } = await supabase
        .from("expense_guests")
        .select("id, expense_id, display_name, claim_token")
        .in("expense_id", expenseIds)
        .is("claimed_by", null);
      guestRows = data ?? [];
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const entries: MemberEntry[] = [];

    const creatorProfile = profileMap.get(group.creator_id);
    if (creatorProfile) {
      entries.push({
        userId: group.creator_id,
        status: "accepted",
        profile: {
          id: creatorProfile.id,
          handle: creatorProfile.handle,
          name: creatorProfile.name,
          avatarUrl: creatorProfile.avatar_url ?? undefined,
        },
        invitedBy: group.creator_id,
      });
    }

    for (const m of memberRows) {
      if (m.user_id === group.creator_id) continue;
      const profile = profileMap.get(m.user_id);
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

    setInviteLinkToken(inviteLinkRows?.[0]?.token ?? null);

    setExpenses(
      (expenseRows ?? []).map((e: { id: string; title: string; total_amount: number; status: string; created_at: string }) => ({
        id: e.id,
        title: e.title,
        totalAmount: e.total_amount,
        status: e.status as ExpenseStatus,
        createdAt: e.created_at,
      }))
    );

    setSettlements(
      (settlementRows ?? []).map((s: { id: string; group_id: string; from_user_id: string; to_user_id: string; amount_cents: number; status: string; created_at: string; confirmed_at: string | null }) => ({
        id: s.id,
        groupId: s.group_id,
        fromUserId: s.from_user_id,
        toUserId: s.to_user_id,
        amountCents: s.amount_cents,
        status: s.status as Settlement["status"],
        createdAt: s.created_at,
        confirmedAt: s.confirmed_at ?? undefined,
      }))
    );

    const expenseTitleMap = new Map(expenseList.map((e) => [e.id, e.title]));
    setUnclaimedGuests(
      guestRows.map((g) => ({
        id: g.id,
        expenseId: g.expense_id,
        displayName: g.display_name,
        claimToken: g.claim_token,
        expenseTitle: expenseTitleMap.get(g.expense_id) ?? "Despesa",
      })),
    );

    if (userId && balanceRows) {
      const result = new Map<string, number>();
      for (const row of balanceRows as { user_a: string; user_b: string; amount_cents: number }[]) {
        if (row.user_a === userId) {
          result.set(row.user_b, (result.get(row.user_b) ?? 0) - row.amount_cents);
        } else {
          result.set(row.user_a, (result.get(row.user_a) ?? 0) + row.amount_cents);
        }
      }
      setMemberBalances(result);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchGroup(user?.id);
  }, [fetchGroup, user?.id]);

  useEffect(() => {
    const handleRefresh = () => {
      setLoading(true);
      fetchGroup(user?.id);
    };
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [fetchGroup, user?.id]);

  const isCreator = user?.id === creatorId;
  const isAcceptedMember = members.some(
    (m) => m.userId === user?.id && m.status === "accepted",
  );
  const canInvite = isCreator || isAcceptedMember;

  const handleRename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === groupName) {
      setEditingName(false);
      return;
    }
    await createClient().from("groups").update({ name: trimmed }).eq("id", id);
    setGroupName(trimmed);
    setEditingName(false);
  };

  const handleLookup = async () => {
    const handle = handleInput.toLowerCase().replace(/^@/, "").trim();
    if (!handle) return;

    setSearching(true);
    setLookupResult(null);
    setLookupError("");

    const { data: profile } = await createClient()
      .rpc("lookup_user_by_handle", { p_handle: handle })
      .maybeSingle();

    const typedProfile = profile as UserProfileRow | null;

    if (!typedProfile) {
      setLookupError(`Nenhum usuário encontrado com @${handle}`);
    } else if (members.some((m) => m.userId === typedProfile.id)) {
      setLookupError("Já tá no grupo");
    } else {
      setLookupResult({
        id: typedProfile.id,
        handle: typedProfile.handle,
        name: typedProfile.name,
        avatarUrl: typedProfile.avatar_url ?? undefined,
      });
    }
    setSearching(false);
  };

  const handleInvite = async () => {
    if (!lookupResult || !user) return;

    const { error } = await createClient().from("group_members").insert({
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
    notifyGroupInvite(id, lookupResult.id).catch(() => {});
    setLookupResult(null);
    setHandleInput("");
    setShowInvite(false);
    await fetchGroup();
  };

  const handleRemoveMember = async () => {
    const { userId } = confirmRemove;
    if (!userId) return;

    setRemoving(true);
    const { error } = await createClient().rpc("remove_group_member", {
      p_group_id: id,
      p_user_id: userId,
    });
    setRemoving(false);

    if (error) {
      setConfirmRemove({ open: false, userId: "", name: "" });
      if (error.message.includes("has_outstanding_balance")) {
        toast.error("Não é possível remover: este membro possui débitos pendentes no grupo.");
        return;
      }
      toast.error("Erro ao remover membro.");
      return;
    }

    setConfirmRemove({ open: false, userId: "", name: "" });
    toast.success("Membro removido do grupo.");
    await fetchGroup();
  };

  const handleLeaveGroup = async () => {
    setLeaving(true);
    const { error } = await createClient().rpc("leave_group", {
      p_group_id: id,
    });
    setLeaving(false);

    if (error) {
      setConfirmLeave(false);
      if (error.message.includes("has_outstanding_balance")) {
        toast.error("Você possui débitos pendentes neste grupo. Quite antes de sair.");
        return;
      }
      toast.error("Erro ao sair do grupo.");
      return;
    }

    setConfirmLeave(false);
    toast.success("Você saiu do grupo.");
    router.push("/app");
  };

  const ensureInviteLink = async (): Promise<string | null> => {
    if (inviteLinkToken) return inviteLinkToken;
    if (!user) return null;

    setCreatingInviteLink(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("group_invite_links")
      .insert({ group_id: id, created_by: user.id })
      .select("token")
      .single();
    setCreatingInviteLink(false);

    if (error || !data) {
      toast.error("Erro ao criar link de convite");
      return null;
    }

    setInviteLinkToken(data.token);
    return data.token;
  };

  const handleOpenInviteModal = async () => {
    const token = await ensureInviteLink();
    if (token) setShowInviteModal(true);
  };

  const participantsAsUsers: User[] = useMemo(() =>
    members
      .filter((m) => m.status === "accepted")
      .map((m) => ({
        id: m.userId,
        email: "",
        handle: m.profile.handle,
        name: m.profile.name,
        pixKeyType: "email" as const,
        pixKeyHint: "",
        avatarUrl: m.profile.avatarUrl,
        onboarded: true,
        createdAt: "",
      })),
    [members],
  );

  const voiceMembers = useMemo(() =>
    members
      .filter((m) => m.status === "accepted")
      .map((m) => ({ handle: m.profile.handle, name: m.profile.name })),
    [members],
  );

  const handleVoiceResult = useCallback((result: VoiceExpenseResult) => {
    setVoiceResult(result);
    setShowVoiceInput(false);
    setVoiceError(null);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
  }, []);

  const handleVoiceConfirm = useCallback((result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => {
    if (!user) return;
    const authUser: User = {
      id: user.id,
      email: user.email ?? "",
      handle: user.handle,
      name: user.name,
      pixKeyType: "email",
      pixKeyHint: "",
      avatarUrl: user.avatarUrl,
      onboarded: true,
      createdAt: "",
    };
    store.setCurrentUser(authUser);
    store.hydrateFromVoice(result, id);

    for (const rp of resolvedParticipants) {
      if (rp.type === "member") {
        store.addParticipant({
          id: rp.userId,
          email: "",
          handle: rp.handle,
          name: rp.name,
          pixKeyType: "email",
          pixKeyHint: "",
          avatarUrl: rp.avatarUrl,
          onboarded: true,
          createdAt: "",
        });
      } else {
        store.addGuest(rp.name);
      }
    }

    setVoiceResult(null);
    setShowVoiceInput(false);
    router.push(`/app/bill/new?groupId=${id}&step=payer`);
  }, [user, store, id, router]);

  const handleVoiceCancel = useCallback(() => {
    setVoiceResult(null);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  const acceptedCount = members.filter((m) => m.status === "accepted").length;
  const activeExpenseCount = expenses.filter((e) => e.status !== "settled").length;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/app/groups"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          {editingName ? (
            <input
              autoFocus
              className="font-semibold bg-transparent border-b border-primary outline-none w-full"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={handleRename}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <h1 className="font-semibold">{groupName}</h1>
              {isCreator && (
                <button
                  onClick={() => { setNameInput(groupName); setEditingName(true); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {acceptedCount} membro{acceptedCount !== 1 ? "s" : ""}
            {activeExpenseCount > 0 && ` · ${activeExpenseCount} conta${activeExpenseCount !== 1 ? "s" : ""} ativa${activeExpenseCount !== 1 ? "s" : ""}`}
          </p>
        </div>
        {canInvite && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={handleOpenInviteModal}
              disabled={creatingInviteLink}
              aria-label="Compartilhar convite"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowInvite(!showInvite)}
            >
              <UserPlus className="h-4 w-4" />
              Convidar
            </Button>
          </div>
        )}
      </div>

      {/* Invite panel */}
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
                    setHandleInput(e.target.value.replace(/ /g, "."));
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
                data-testid="lookup-result"
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

      {/* Notification opt-in prompt */}
      <div className="mt-4">
        <NotificationPrompt />
      </div>

      {/* Tab bar */}
      <div className="mt-5 flex gap-1 rounded-xl bg-muted p-1">
        {(["membros", "contas", "pagamentos", "acerto"] as Tab[]).map((tab) => {
          const label = { membros: "Membros", contas: "Contas", pagamentos: "Pagamentos", acerto: "Acerto" }[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all ${
                activeTab === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Members tab */}
      {activeTab === "membros" && (
        <div className="mt-4 space-y-2">
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
                      Você
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
              {(() => {
                const bal = member.userId !== user?.id ? memberBalances.get(member.userId) : undefined;
                if (!bal || Math.abs(bal) < 2) return null;
                return (
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-semibold tabular-nums ${bal > 0 ? "text-success" : "text-destructive"}`}>
                      {bal > 0 ? "+" : ""}{formatBRL(Math.abs(bal))}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {bal > 0 ? "te deve" : "você deve"}
                    </p>
                  </div>
                );
              })()}
              {isCreator && member.userId !== creatorId && (
                <button
                  onClick={() =>
                    setConfirmRemove({
                      open: true,
                      userId: member.userId,
                      name: member.profile.name,
                    })
                  }
                  className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </motion.div>
          ))}

          {!isCreator && isAcceptedMember && (
            <button
              onClick={() => setConfirmLeave(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sair do grupo
            </button>
          )}

          {unclaimedGuests.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                Convidados pendentes
              </h3>
              <div className="space-y-2">
                {unclaimedGuests.map((guest) => (
                  <div
                    key={guest.id}
                    className="flex items-center justify-between rounded-xl border border-dashed bg-card p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                        {guest.displayName.charAt(0)}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{guest.displayName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {guest.expenseTitle}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={() =>
                        setGuestShareModal({
                          open: true,
                          guestName: guest.displayName,
                          claimToken: guest.claimToken,
                          expenseTitle: guest.expenseTitle,
                        })
                      }
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Convidar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expenses tab */}
      {activeTab === "contas" && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => router.push(`/app/bill/new?groupId=${id}`)}
            >
              <Plus className="h-4 w-4" />
              Nova conta
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setShowVoiceInput(!showVoiceInput)}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>

          {voiceResult && (
            <VoiceExpenseModal
              result={voiceResult}
              groupMembers={members
                .filter((m) => m.status === "accepted")
                .map((m) => ({
                  id: m.userId,
                  handle: m.profile.handle,
                  name: m.profile.name,
                  avatarUrl: m.profile.avatarUrl,
                }))}
              onConfirm={handleVoiceConfirm}
              onCancel={handleVoiceCancel}
            />
          )}

          {showVoiceInput && (
            <div className="space-y-2">
              <VoiceExpenseButton
                members={voiceMembers}
                onResult={handleVoiceResult}
                onError={handleVoiceError}
              />
              {voiceError && (
                <p className="text-center text-sm text-destructive">{voiceError}</p>
              )}
            </div>
          )}

          {expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhuma conta ainda"
              description="Adiciona uma conta pra dividir com o grupo. Pode ser um jantar, mercado, ou qualquer gasto compartilhado."
              actionLabel="Nova conta"
              onAction={() => router.push(`/app/bill/new?groupId=${id}`)}
            />
          ) : (
            expenses.map((expense) => {
              const statusCfg = expenseStatusConfig[expense.status];
              return (
                <Link key={expense.id} href={`/app/bill/${expense.id}`}>
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Receipt className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{expense.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(expense.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold text-sm tabular-nums">
                        {formatBRL(expense.totalAmount)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                  </motion.div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {/* Settlement tab */}
      {activeTab === "acerto" && user && (
        <div className="mt-4">
          <GroupSettlementView
            groupId={id}
            participants={participantsAsUsers}
            currentUserId={user.id}
          />
        </div>
      )}

      {/* Payments (settlement history) tab */}
      {activeTab === "pagamentos" && (
        <div className="mt-4 space-y-2">
          {settlements.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nenhum pagamento ainda"
              description="Quando alguém pagar uma dívida do grupo, o registro aparece aqui."
            />
          ) : (
            settlements.map((settlement) => {
              const from = members.find((m) => m.userId === settlement.fromUserId);
              const to = members.find((m) => m.userId === settlement.toUserId);
              const statusCfg = settlementStatusConfig[settlement.status] ?? settlementStatusConfig.pending;
              return (
                <div
                  key={settlement.id}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <UserAvatar
                    name={from?.profile.name ?? "?"}
                    avatarUrl={from?.profile.avatarUrl}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1">
                      {from?.profile.name.split(" ")[0] ?? "?"}
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {to?.profile.name.split(" ")[0] ?? "?"}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-muted-foreground">
                        {new Date(settlement.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                      {settlement.status === "confirmed" && (
                        <CheckCheck className="h-3 w-3 text-success" />
                      )}
                      {settlement.status === "pending" && (
                        <Clock className="h-3 w-3 text-warning-foreground" />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-semibold text-sm tabular-nums">
                      {formatBRL(settlement.amountCents)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <GuestClaimShareModal
        open={guestShareModal.open}
        onClose={() => setGuestShareModal({ ...guestShareModal, open: false })}
        guestName={guestShareModal.guestName}
        claimToken={guestShareModal.claimToken}
        expenseTitle={guestShareModal.expenseTitle}
      />

      <GroupInviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        groupName={groupName}
        token={inviteLinkToken ?? ""}
      />

      {/* Confirm member removal dialog */}
      <Dialog
        open={confirmRemove.open}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove({ open: false, userId: "", name: "" });
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remover membro</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{confirmRemove.name}</strong> do grupo?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRemove({ open: false, userId: "", name: "" })}
              disabled={removing}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMember}
              disabled={removing}
            >
              {removing ? "Removendo…" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm leave group dialog */}
      <Dialog
        open={confirmLeave}
        onOpenChange={(open) => {
          if (!open) setConfirmLeave(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Sair do grupo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja sair de <strong>{groupName}</strong>? Você precisará de um novo convite para voltar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmLeave(false)}
              disabled={leaving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeaveGroup}
              disabled={leaving}
            >
              {leaving ? "Saindo…" : "Sair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
