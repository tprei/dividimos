"use client";

import { motion } from "framer-motion";
import { Check, Clock, Crown, LogOut, QrCode, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  deleteGroup,
  createGuestClaimToken,
  leaveGroup,
  removeMember,
} from "@/lib/sync/mutations-group";
import type { GroupSnapshot } from "@/types/ledger";



interface GroupMembersSectionProps {
  snapshot: GroupSnapshot;
  meId: string;
  onDepart: () => void;
}

export function GroupMembersSection({ snapshot, meId, onDepart }: GroupMembersSectionProps) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareGuest, setShareGuest] = useState<{
    guestId: string;
    guestName: string;
    token: string;
    expenseTitle: string;
  } | null>(null);
  const [shareGeneration, setShareGeneration] = useState(0);
  const [issuingGuestId, setIssuingGuestId] = useState<string | null>(null);

  const creatorId = snapshot.group.creatorId;
  const isCreator = meId === creatorId;
  const isAcceptedMember = snapshot.members.some(
    (m) => m.userId === meId && m.status === "accepted",
  );

  const handleRemoveMember = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    try {
      await removeMember(snapshot.group.id, confirmRemove.userId);
      toast.success("Membro removido do grupo.");
      setConfirmRemove(null);
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setRemoving(false);
    }
  };

  const handleLeaveGroup = async () => {
    setLeaving(true);
    try {
      await leaveGroup(snapshot.group.id);
      toast.success("Você saiu do grupo.");
      onDepart();
      router.replace("/app/groups");
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
      setConfirmLeave(false);
    } finally {
      setLeaving(false);
    }
  };

  const handleShareGuest = async (guest: {
    id: string;
    displayName: string;
    expenseId: string;
  }) => {
    setIssuingGuestId(guest.id);
    try {
      const { token } = await createGuestClaimToken(guest.id);
      const expense = snapshot.recentExpenses.find((e) => e.id === guest.expenseId);
      const expenseTitle = expense?.title ?? snapshot.group.name;
      setShareGuest({
        guestId: guest.id,
        guestName: guest.displayName,
        token,
        expenseTitle,
      });
      setShareGeneration((g) => g + 1);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setIssuingGuestId(null);
    }
  };

  const handleDeleteGroup = async () => {
    setDeleting(true);
    try {
      await deleteGroup(snapshot.group.id);
      toast.success("Grupo excluído.");
      onDepart();
      router.replace("/app/groups");
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section>
      <div className="space-y-2">
        {snapshot.members.map((member) => (
          <motion.div
            key={member.userId}
            layout
            className="flex items-center gap-3 rounded-xl border bg-card p-3"
          >
            <UserAvatar
              name={member.user.name}
              avatarUrl={member.user.avatarUrl}
              size="sm"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{member.user.name}</p>
                {member.userId === creatorId && (
                  <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Crown className="h-2.5 w-2.5" />
                    Criador
                  </span>
                )}
                {member.userId === meId && member.userId !== creatorId && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Você
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-muted-foreground">
                  @{member.user.handle}
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
            {isCreator && member.userId !== meId && (
              <button
                onClick={() =>
                  setConfirmRemove({ userId: member.userId, name: member.user.name })
                }
                aria-label={`Remover ${member.user.name}`}
                className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        ))}

        {snapshot.guests.length > 0 && (
          <div className="pt-2">
            <div className="space-y-2">
              {snapshot.guests.map((guest) => (
                <div
                  key={guest.id}
                  className="rounded-xl border border-dashed bg-card p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                        {guest.displayName.charAt(0)}
                      </span>
                      <p className="text-sm font-medium">{guest.displayName}</p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Convidado
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full gap-1.5 text-xs"
                    disabled={issuingGuestId === guest.id}
                    onClick={() => handleShareGuest(guest)}
                    aria-label={`Compartilhar convite de ${guest.displayName}`}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Compartilhar convite
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isCreator ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir grupo
          </button>
        ) : (
          isAcceptedMember && (
            <button
              onClick={() => setConfirmLeave(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sair do grupo
            </button>
          )
        )}
      </div>

      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remover membro</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{confirmRemove?.name}</strong> do grupo?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRemove(null)}
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
              Tem certeza que deseja sair de <strong>{snapshot.group.name}</strong>? Você precisará de um novo convite para voltar.
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

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Excluir grupo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{snapshot.group.name}</strong>? Todos os membros perderão o acesso e as contas ficarão indisponíveis.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteGroup}
              disabled={deleting}
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GuestClaimShareModal
        key={shareGeneration}
        open={shareGuest !== null}
        onClose={() => setShareGuest(null)}
        guestName={shareGuest?.guestName ?? ""}
        token={shareGuest?.token ?? null}
        expenseTitle={shareGuest?.expenseTitle ?? ""}
        footer={
          shareGuest !== null ? (
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={issuingGuestId === shareGuest.guestId}
              onClick={() =>
                handleShareGuest({
                  id: shareGuest.guestId,
                  displayName: shareGuest.guestName,
                  expenseId:
                    snapshot.guests.find((g) => g.id === shareGuest.guestId)?.expenseId ?? "",
                })
              }
            >
              Gerar novo link
            </Button>
          ) : null
        }
      />
    </section>
  );
}
