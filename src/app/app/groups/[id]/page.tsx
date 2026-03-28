"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Clock,
  Plus,
  Receipt,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { GroupSettlementView } from "@/components/group/group-settlement-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/currency";
import { coerceBillStatus } from "@/lib/type-guards";
import toast from "react-hot-toast";
import type { BillStatus, GroupMemberStatus, User, UserProfile } from "@/types";
import type { Database } from "@/types/database";

type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

interface MemberEntry {
  userId: string;
  status: GroupMemberStatus;
  profile: UserProfile;
  invitedBy: string;
}

interface BillSummaryEntry {
  id: string;
  title: string;
  totalAmount: number;
  status: BillStatus;
  createdAt: string;
}

interface BillQueryRow {
  id: string;
  title: string;
  total_amount: number;
  status: BillStatus;
  created_at: string;
}

const billStatusConfig: Record<BillStatus, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  active: { label: "Pendente", color: "bg-warning/15 text-warning-foreground" },
  partially_settled: { label: "Parcial", color: "bg-primary/15 text-primary" },
  settled: { label: "Liquidado", color: "bg-success/15 text-success" },
};

type Tab = "membros" | "contas" | "acerto" | "pagamentos";

interface PaymentEntry {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

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
  const [bills, setBills] = useState<BillSummaryEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("membros");
  const [showInvite, setShowInvite] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [lookupResult, setLookupResult] = useState<UserProfile | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [searching, setSearching] = useState(false);

  const fetchGroup = useCallback(async () => {
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

    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, handle, name, avatar_url")
      .in("id", allUserIds);

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

    // Fetch group bills + settlement payments in parallel
    const [{ data: billRows }, { data: settlementRows }] = await Promise.all([
      supabase
        .from("bills")
        .select("id, title, total_amount, status, created_at")
        .eq("group_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("group_settlements")
        .select("id")
        .eq("group_id", id),
    ]);

    setBills(
      (billRows ?? []).map((b: BillQueryRow) => ({
        id: b.id,
        title: b.title,
        totalAmount: b.total_amount,
        status: coerceBillStatus(b.status, "draft"),
        createdAt: b.created_at,
      }))
    );

    const settlementIds = (settlementRows ?? []).map((s: { id: string }) => s.id);
    if (settlementIds.length > 0) {
      const { data: paymentRows } = await supabase
        .from("payments")
        .select("id, from_user_id, to_user_id, amount_cents, status, created_at")
        .in("group_settlement_id", settlementIds)
        .order("created_at", { ascending: false });

      setPayments(
        (paymentRows ?? []).map((p: { id: string; from_user_id: string; to_user_id: string; amount_cents: number; status: string; created_at: string }) => ({
          id: p.id,
          fromUserId: p.from_user_id,
          toUserId: p.to_user_id,
          amountCents: p.amount_cents,
          status: p.status,
          createdAt: p.created_at,
        }))
      );
    } else {
      setPayments([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  useEffect(() => {
    const handleRefresh = () => {
      setLoading(true);
      fetchGroup();
    };
    window.addEventListener("app-refresh", handleRefresh);
    return () => window.removeEventListener("app-refresh", handleRefresh);
  }, [fetchGroup]);

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

    const { data: profile } = await createClient()
      .rpc("lookup_user_by_handle", { p_handle: handle })
      .maybeSingle();

    const typedProfile = profile as UserProfileRow | null;

    if (!typedProfile) {
      setLookupError(`Nenhum usuario encontrado com @${handle}`);
    } else if (members.some((m) => m.userId === typedProfile.id)) {
      setLookupError("Ja esta no grupo");
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
    setLookupResult(null);
    setHandleInput("");
    setShowInvite(false);
    await fetchGroup();
  };

  const handleRemoveMember = async (userId: string) => {
    await createClient()
      .from("group_members")
      .delete()
      .eq("group_id", id)
      .eq("user_id", userId);
    await fetchGroup();
  };

  // Convert MemberEntry[] to User[] for settlement view
  const participantsAsUsers: User[] = members
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
    }));

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
  const activeBillCount = bills.filter((b) => b.status !== "settled").length;

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
          <h1 className="font-semibold">{groupName}</h1>
          <p className="text-xs text-muted-foreground">
            {acceptedCount} membro{acceptedCount !== 1 ? "s" : ""}
            {activeBillCount > 0 && ` · ${activeBillCount} conta${activeBillCount !== 1 ? "s" : ""} ativa${activeBillCount !== 1 ? "s" : ""}`}
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
      )}

      {/* Bills tab */}
      {activeTab === "contas" && (
        <div className="mt-4 space-y-3">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => router.push(`/app/bill/new?groupId=${id}`)}
          >
            <Plus className="h-4 w-4" />
            Nova conta do grupo
          </Button>

          {bills.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Receipt className="mx-auto h-8 w-8 opacity-50" />
              <p className="mt-2 text-sm">Nenhuma conta ainda</p>
              <p className="text-xs">Crie uma conta para comecar</p>
            </div>
          ) : (
            bills.map((bill) => {
              const statusCfg = billStatusConfig[bill.status];
              return (
                <Link key={bill.id} href={`/app/bill/${bill.id}`}>
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Receipt className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{bill.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(bill.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold text-sm tabular-nums">
                        {formatBRL(bill.totalAmount)}
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

      {/* Payments tab */}
      {activeTab === "pagamentos" && (
        <div className="mt-4 space-y-2">
          {payments.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Receipt className="mx-auto h-8 w-8 opacity-50" />
              <p className="mt-2 text-sm">Nenhum pagamento ainda</p>
            </div>
          ) : (
            payments.map((payment) => {
              const from = members.find((m) => m.userId === payment.fromUserId);
              const to = members.find((m) => m.userId === payment.toUserId);
              return (
                <div
                  key={payment.id}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <span className="text-sm font-bold text-primary">
                      {from?.profile.name.charAt(0) || "?"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {from?.profile.name.split(" ")[0] || "?"} → {to?.profile.name.split(" ")[0] || "?"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-semibold text-sm tabular-nums">
                      {formatBRL(payment.amountCents)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      payment.status === "settled"
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning-foreground"
                    }`}>
                      {payment.status === "settled" ? "Confirmado" : "Pendente"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}