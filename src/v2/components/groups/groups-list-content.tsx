"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Plus, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { GroupRowSkeleton } from "@/components/shared/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  acceptInvitation,
  createGroup,
  declineInvitation,
} from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, GroupMember } from "@/types/ledger";

function isInvitedHere(snapshot: GroupSnapshot, meId: string | null): boolean {
  if (!meId) return false;
  return snapshot.members.some(
    (m) => m.userId === meId && m.status === "invited",
  );
}

function invitedByMember(
  snapshot: GroupSnapshot,
  meId: string | null,
): GroupMember | null {
  if (!meId) return null;
  return snapshot.members.find((m) => m.userId === meId) ?? null;
}

function netInGroup(snapshot: GroupSnapshot, meId: string | null): number {
  if (!meId) return 0;
  const row = snapshot.balances.find(
    (b) => b.kind === "user" && b.participantId === meId,
  );
  return row?.netCents ?? 0;
}

export function GroupsListContent() {
  const router = useRouter();
  const { hydrated, groupOrder, groups } = useAppStore(
    useShallow((s) => ({
      hydrated: s.hydrated,
      groupOrder: s.groupOrder,
      groups: s.groups,
    })),
  );
  const meId = useAppStore((s) => s.me?.id ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const { joined, invites } = useMemo(() => {
    const joinedRows: GroupSnapshot[] = [];
    const inviteRows: GroupSnapshot[] = [];
    for (const id of groupOrder) {
      const snapshot = groups[id];
      if (!snapshot || snapshot.group.kind !== "group") continue;
      if (isInvitedHere(snapshot, meId)) inviteRows.push(snapshot);
      else joinedRows.push(snapshot);
    }
    return { joined: joinedRows, invites: inviteRows };
  }, [groupOrder, groups, meId]);

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const ack = await createGroup(name, []);
      router.push(`/app/groups/${ack.groupId}`);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const handleAcceptInvite = async (groupId: string) => {
    try {
      await acceptInvitation(groupId);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    }
  };

  const handleDeclineInvite = async (groupId: string) => {
    try {
      await declineInvitation(groupId);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    }
  };

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border bg-card">
            <GroupRowSkeleton />
          </div>
        ))}
      </div>
    );
  }

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
            {joined.length} grupo{joined.length !== 1 ? "s" : ""}
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
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Convites pendentes</h2>
          </div>
          <div className="space-y-2">
            {invites.map((snapshot) => {
              const membership = invitedByMember(snapshot, meId);
              const inviter =
                snapshot.members.find(
                  (m) => m.userId === membership?.invitedBy,
                ) ?? null;
              return (
                <div
                  key={snapshot.group.id}
                  className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-4"
                >
                  <div>
                    <p className="font-medium">{snapshot.group.name}</p>
                    {inviter && (
                      <p className="text-xs text-muted-foreground">
                        Convidado por {inviter.user.name}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground"
                      onClick={() => handleDeclineInvite(snapshot.group.id)}
                      aria-label="Recusar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => handleAcceptInvite(snapshot.group.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aceitar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6 space-y-3"
      >
        {joined.map((snapshot) => {
          const accepted = snapshot.members.filter(
            (m) => m.status === "accepted",
          );
          const memberCount = snapshot.members.length;
          const net = netInGroup(snapshot, meId);
          return (
            <motion.div key={snapshot.group.id} variants={staggerItem}>
              <Link href={`/app/groups/${snapshot.group.id}`}>
                <div className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{snapshot.group.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {memberCount} membro{memberCount !== 1 ? "s" : ""}
                      {net > 2 && (
                        <span className="text-success">
                          {" "}
                          · a receber {formatBRL(net)}
                        </span>
                      )}
                      {net < -2 && (
                        <span className="text-destructive">
                          {" "}
                          · a pagar {formatBRL(-net)}
                        </span>
                      )}
                    </p>
                  </div>
                  {snapshot.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {snapshot.unreadCount}
                    </span>
                  )}
                  <div className="flex -space-x-2">
                    {accepted.slice(0, 3).map((m) => (
                      <UserAvatar
                        key={m.userId}
                        name={m.user.name}
                        avatarUrl={m.user.avatarUrl}
                        size="xs"
                        className="ring-2 ring-card"
                      />
                    ))}
                    {accepted.length > 3 && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-bold ring-2 ring-card">
                        +{accepted.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}

        {joined.length === 0 && invites.length === 0 && (
          <EmptyState
            icon={Users}
            title="Nenhum grupo ainda"
            description="Grupos juntam a galera pra dividir contas. Cria um e convida seus amigos pelo @handle."
            actionLabel="Criar grupo"
            onAction={() => setShowCreate(true)}
          />
        )}
      </motion.div>
    </div>
  );
}
