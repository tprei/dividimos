"use client";

import { Clock, Crown, LogOut, QrCode, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { PersonLabel } from "@/components/shared/person-label";
import { Chip } from "@/components/ui/chip";
import { displayNames } from "@/lib/people";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle } from "@/components/ui/popover";
import { haptics } from "@/hooks/use-haptics";
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
  settingsOnly?: boolean;
}

export function GroupMembersSection({ snapshot, meId, onDepart, settingsOnly = false }: GroupMembersSectionProps) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState<{
    userId: string;
    name: string;
    anchor: HTMLButtonElement;
    pending: boolean;
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
  const labels = displayNames([
    ...snapshot.members.map((member) => member.user),
    ...snapshot.guests.map((guest) => ({ id: guest.id, name: guest.displayName, isGuest: true })),
  ], { style: "full" });

  const handleRemoveMember = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    try {
      await removeMember(snapshot.group.id, confirmRemove.userId);
      haptics.success();
      toast.success(confirmRemove.pending ? "Convite cancelado" : "Membro removido");
      setConfirmRemove(null);
    } catch (e) {
      haptics.error();
      toast.error(ledgerErrorMessage(e));
    } finally {
      setRemoving(false);
    }
  };

  const handleLeaveGroup = async () => {
    setLeaving(true);
    try {
      await leaveGroup(snapshot.group.id);
      haptics.success();
      toast.success("Você saiu do grupo.");
      onDepart();
      router.replace("/app/groups");
    } catch (e) {
      haptics.error();
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
    haptics.tap();
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
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    } finally {
      setIssuingGuestId(null);
    }
  };

  const handleDeleteGroup = async () => {
    setDeleting(true);
    try {
      await deleteGroup(snapshot.group.id);
      haptics.success();
      toast.success("Grupo excluído.");
      onDepart();
      router.replace("/app/groups");
    } catch (e) {
      haptics.error();
      toast.error(ledgerErrorMessage(e));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section>
      <div className="space-y-2">
        {!settingsOnly && snapshot.members.map((member) => (
          <div
            key={member.userId}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <UserAvatar
              id={member.userId}
              name={member.user.name}
              avatarUrl={member.user.avatarUrl}
              size="sm"
              isBot={member.user.isBot}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <PersonLabel name={member.user.name} overrideName={labels.get(member.userId)} nameClassName="text-base" />
                {member.userId === creatorId && (
                  <Chip tone="primary" icon={<Crown />}>Criador</Chip>
                )}
                {member.userId === meId && (
                  <Chip tone="primary">Você</Chip>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <p title={`@${member.user.handle}`} className="truncate text-xs text-muted-foreground">
                  @{member.user.handle}
                </p>
                {member.status === "invited" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Pendente
                  </span>
                )}
              </div>
            </div>
            {isCreator && member.userId !== meId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  haptics.tap();
                  setConfirmRemove({ userId: member.userId, name: member.user.name, anchor: event.currentTarget, pending: member.status === "invited" });
                }}
                aria-label={member.status === "invited" ? `Cancelar convite de ${member.user.name}` : `Remover ${member.user.name}`}
                className="shrink-0 text-muted-foreground hover:text-destructive-text"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}


        {!settingsOnly && snapshot.guests.length > 0 && (
          <div className="pt-2">
            <div className="space-y-2">
              {snapshot.guests.map((guest) => (
                <div
                  key={guest.id}
                  className="rounded-xl border border-dashed bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <GuestAvatar id={guest.id} name={guest.displayName} size="sm" />
                      <PersonLabel name={guest.displayName} overrideName={labels.get(guest.id)} nameClassName="text-sm" />
                    </div>
                    <Chip tone="guest">Convidado</Chip>
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

        {settingsOnly && (isCreator ? (
          <Button
            variant="outline"
            onClick={() => setConfirmDelete(true)}
            className="w-full gap-2 border-destructive/30 text-destructive-text hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir grupo
          </Button>
        ) : (
          isAcceptedMember && (
            <Button
              variant="outline"
              onClick={() => setConfirmLeave(true)}
              className="w-full gap-2 border-destructive/30 text-destructive-text hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sair do grupo
            </Button>
          )
        ))}
      </div>

      <Popover open={confirmRemove !== null} onOpenChange={(open) => { if (!open) setConfirmRemove(null); }}>
        <PopoverContent anchor={confirmRemove?.anchor} align="end">
          <PopoverTitle>{confirmRemove?.pending ? "Cancelar convite?" : "Remover membro?"}</PopoverTitle>
          <PopoverDescription>
            {confirmRemove?.pending ? `Cancelar o convite de ${confirmRemove.name}?` : `${confirmRemove?.name} perderá o acesso ao grupo.`}
          </PopoverDescription>
          <Button variant="destructive" onClick={handleRemoveMember} disabled={removing}>
            {removing ? "Removendo…" : confirmRemove?.pending ? "Cancelar convite" : "Remover"}
          </Button>
        </PopoverContent>
      </Popover>

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
