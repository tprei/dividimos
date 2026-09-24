"use client";

import { MoreHorizontal, Pencil, Receipt, RotateCcw, Share2, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ExpenseHistory } from "./expense-history";
import { ExpenseItems } from "./expense-items";
import { ExpensePayers } from "./expense-payers";
import { ExpenseParticipantList } from "./expense-participant-list";
import { GuestInviteDialog } from "./guest-invite-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Skeleton } from "@/components/shared/skeleton";
import { ScrollHint } from "@/components/shared/scroll-hint";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { haptics } from "@/hooks/use-haptics";
import { displayNames } from "@/lib/people";
import { shareLink } from "@/lib/platform/share";
import { formatOccurredOn } from "@/stores/app-selectors";
import { copyText } from "@/lib/platform/clipboard";
import { formatServiceFeeBasisPoints } from "@/lib/expense-money";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
} from "@/components/ui/popover";
import { useMe } from "@/hooks/use-me";
import { attributePayers } from "@/lib/expense-attribution";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { deleteExpense, restoreExpense } from "@/lib/sync/mutations";
import { refreshExpense } from "@/lib/sync/refresh";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { expenseReadKey, IDLE_READ, useAppStore } from "@/stores/app-store";

export function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const me = useMe();
  const detail = useAppStore((s) => s.expenseDetails[expenseId]);
  const assignmentRoom = useAppStore(
    (s) => s.assignmentRoomsByExpenseId[expenseId],
  );
  const snapshot = useAppStore((s) =>
    detail ? s.groups[detail.group.id] : undefined,
  );

  const [unavailable, setUnavailable] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [deleteAnchor, setDeleteAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [inviteIndex, setInviteIndex] = useState<number | null>(null);
  const [roomSection, setRoomSection] = useState({ expenseId, value: "people" });
  const activeRoomSection = roomSection.expenseId === expenseId ? roomSection.value : "people";
  // Default focus of the delete confirmation stays on the safe action.
  const cancelFocusRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const inviteParticipant =
    inviteIndex === null
      ? null
      : detail?.participants.find((p) => p.participantIndex === inviteIndex) ?? null;

  const read = useAppStore((s) => s.reads[expenseReadKey(expenseId)] ?? IDLE_READ);

  const load = useCallback(() => {
    setUnavailable(false);
    refreshExpense(expenseId).catch((error: unknown) => {
      if (
        error instanceof LedgerError &&
        (error.code === "expense_not_found" || error.code === "not_a_member")
      ) {
        // Authoritative absence, not a failed read.
        setUnavailable(true);
        return;
      }
      // Anything else is recorded as a failed read; only warn when there is
      // already something on screen to keep.
      if (useAppStore.getState().expenseDetails[expenseId] !== undefined) {
        toast.error(ledgerErrorMessage(error));
      }
    });
  }, [expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  const members = snapshot?.members;
  const invitedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const member of members ?? []) {
      if (member.status === "invited") ids.add(member.userId);
    }
    return ids;
  }, [members]);
  const payloadParticipants = detail?.current.payload.participants;

  const nameOf = useCallback(
    (userId: string): string => {
      const member = members?.find((m) => m.userId === userId);
      if (member) return member.user.name;
      const participantUser = detail?.participants
        .map((p) => p.user)
        .find((user) => user?.id === userId);
      if (participantUser) return participantUser.name;
      return "Alguém";
    },
    [members, detail],
  );

  const avatarUrlOf = useCallback(
    (userId: string): string | null => {
      const member = members?.find((m) => m.userId === userId);
      if (member) return member.user.avatarUrl;
      const participantUser = detail?.participants
        .map((p) => p.user)
        .find((user) => user?.id === userId);
      if (participantUser) return participantUser.avatarUrl;
      return null;
    },
    [members, detail],
  );

  const participantName = useCallback(
    (participantIndex: number): string => {
      const ref = payloadParticipants?.[participantIndex];
      if (!ref) return "Alguém";
      if (ref.kind === "user") return nameOf(ref.userId);
      return ref.displayName;
    },
    [payloadParticipants, nameOf],
  );

  const participantId = useCallback((index: number): string => {
    const participant = detail?.participants.find((person) => person.participantIndex === index);
    return participant?.user?.id ?? participant?.guest?.id ?? `${expenseId}:${index}`;
  }, [detail, expenseId]);

  const participantAvatarUrl = useCallback(
    (participantIndex: number): string | null => {
      const ref = payloadParticipants?.[participantIndex];
      if (!ref || ref.kind !== "user") return null;
      return avatarUrlOf(ref.userId);
    },
    [payloadParticipants, avatarUrlOf],
  );

  const participantIsGuest = useCallback(
    (participantIndex: number): boolean =>
      payloadParticipants?.[participantIndex]?.kind === "guest",
    [payloadParticipants],
  );

  if (unavailable) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <ScreenHeader
          back
          title="Conta"
          onBack={() => router.push("/app")}
        />
        <EmptyState
          icon={Receipt}
          title="Essa conta não está mais disponível"
          description="Ela pode ter sido excluída ou você não tem mais acesso ao grupo."
          actionLabel="Voltar"
          onAction={() => router.push("/app")}
        />
      </div>
    );
  }

  // A failed read is not a missing expense: never show the skeleton forever or
  // claim the bill is gone.
  if (!detail && read.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <ScreenHeader back title="Conta" />
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(read.code))}
          onRetry={load}
        />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  const { expense, current } = detail;
  const payers = attributePayers(current.payload.payers, current.totalCents);
  const isDeleted = expense.status === "deleted";
  const canManage =
    assignmentRoom === undefined || assignmentRoom.hostUserId === me?.id;
  const names = displayNames(detail.participants.map((p) => ({
    id: participantId(p.participantIndex), name: participantName(p.participantIndex),
    handle: p.user?.handle, isGuest: p.kind === "guest",
  })), { style: "full", viewerId: me?.id, selfLabel: "você" });
  const payerNames = payers.map((payer) => names.get(participantId(payer.participantIndex))).join(", ");
  const unclaimedGuest = detail.participants.find((p) => p.guest?.claimedBy === null);

  async function handleDelete() {
    setWorking(true);
    try {
      await deleteExpense(expenseId);
      haptics.error();
      toast.success("Conta excluída");
      setConfirmOpen(false);
    } catch (error) {
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function handleRestore() {
    setWorking(true);
    try {
      await restoreExpense(expenseId);
      haptics.success();
      toast.success("Conta restaurada");
    } catch (error) {
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  const participantList = (
    <ExpenseParticipantList
      participants={detail.participants}
      meId={me?.id ?? null}
      invitedUserIds={invitedUserIds}
      showHeading={!assignmentRoom}
      onInviteGuest={(participant) => {
        setInviteIndex(participant.participantIndex);
      }}
    />
  );
  const items = current.expenseType === "itemized" &&
    current.payload.items.length > 0 ? (
      <ExpenseItems
        items={current.payload.items}
        itemAssignments={current.payload.itemAssignments}
        participantName={participantName}
        participantId={participantId}
        payers={payers}
        participantAvatarUrl={participantAvatarUrl}
        participantIsGuest={participantIsGuest}
        showHeading={!assignmentRoom}
      />
    ) : null;
  const history = (
    <ExpenseHistory
      versions={detail.versions}
      nameOf={nameOf}
      avatarUrlOf={avatarUrlOf}
      showHeading={!assignmentRoom}
    />
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col md:max-w-2xl">
      <ScreenHeader
        back
        title={current.title}
        subtitle={`${detail.group.name} · ${formatOccurredOn(current.occurredOn)} · pago por ${payerNames}`}
        action={<>
          {canManage && !isDeleted && <Button variant="ghost" size="icon" aria-label="Editar conta" onClick={() => router.push(`/app/bill/new?edit=${expenseId}`)}><Pencil className="size-5" /></Button>}
          <Button ref={menuAnchor} variant="ghost" size="icon" aria-label="Mais opções" onClick={() => setMenuOpen(true)}><MoreHorizontal className="size-5" /></Button>
        </>}
      />
      <div className="px-4 py-6">
        <p className="mb-1 text-sm text-muted-foreground">Total da conta</p>
        <Money cents={current.totalCents} size="hero" />
      </div>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverContent anchor={menuAnchor.current} align="end">
          <PopoverTitle>Opções da conta</PopoverTitle>
          <Button variant="ghost" className="w-full justify-start" onClick={() => {
            setMenuOpen(false);
            void shareLink({ title: current.title, url: window.location.href }).then(async (outcome) => {
              if (outcome === "unsupported") {
                if (await copyText(window.location.href)) {
                  haptics.success();
                  toast.success("Link copiado");
                } else toast.error("Não deu pra copiar o link.");
              }
            }).catch(() => toast.error("Não deu pra compartilhar a conta."));
          }}><Share2 className="size-4" />Compartilhar conta</Button>
          {unclaimedGuest && <Button variant="ghost" className="w-full justify-start" onClick={() => { setMenuOpen(false); setInviteIndex(unclaimedGuest.participantIndex); }}><UserPlus className="size-4" />Convidar participante</Button>}
          {canManage && !isDeleted && <Button variant="ghost" className="w-full justify-start text-destructive-text" onClick={() => { setDeleteAnchor(menuAnchor.current); setMenuOpen(false); setConfirmOpen(true); }}><Trash2 className="size-4" />Excluir conta</Button>}
          {assignmentRoom && <Button variant="ghost" className="w-full justify-start" onClick={() => router.push(`/room/${assignmentRoom.id}`)}><Receipt className="size-4" />Ver sala</Button>}
        </PopoverContent>
      </Popover>

      <div className="px-4">
        {isDeleted && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3">
            <p className="text-sm text-muted-foreground">Conta excluída</p>
            {canManage && <Button variant="outline" disabled={working} onClick={handleRestore}><RotateCcw className="size-4" />Restaurar</Button>}
          </div>
        )}

      </div>
      <div className="px-4">
        <ExpensePayers
          payers={payers}
          participantName={participantName}
          participantId={participantId}
          participantAvatarUrl={participantAvatarUrl}
          participantIsGuest={participantIsGuest}
        />
      </div>
      {(current.serviceFeeBasisPoints > 0 || current.fixedFeeCents > 0) && (
        <section className="mt-6 px-4">
          <h2 className="mb-3 text-lg font-semibold">Taxas</h2>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 text-sm">
            {current.serviceFeeBasisPoints > 0 && <p className="flex justify-between gap-3"><span>Taxa de serviço</span><span>{formatServiceFeeBasisPoints(current.serviceFeeBasisPoints)}</span></p>}
            {current.fixedFeeCents > 0 && <p className="flex justify-between gap-3"><span>Taxa fixa</span><Money cents={current.fixedFeeCents} size="sm" /></p>}
          </div>
        </section>
      )}

      {assignmentRoom ? (
        <section className="mt-5 px-4" aria-label="Sala de itens">
          <h2 className="text-sm font-semibold">Sala de itens</h2>
          <div className="mt-3 space-y-4">
            <SegmentedControl aria-label="Sala de itens" value={activeRoomSection} onChange={(value) => setRoomSection({ expenseId, value })} options={[{ value: "items", label: "Por item" }, { value: "people", label: "Por pessoa" }, { value: "history", label: "Histórico" }]} />
            {activeRoomSection === "items" && items}
            {activeRoomSection === "people" && participantList}
            {activeRoomSection === "history" && history}
          </div>
        </section>
      ) : (
        <>
          <div className="px-4">{participantList}</div>
          {items && <div className="px-4">{items}</div>}
          <div className="px-4">{history}</div>
        </>
      )}

      <footer ref={footerRef} className="mt-6 border-t bg-background px-4 py-3">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full text-base font-bold"
          onClick={() => router.push("/app")}
        >
          Pronto
        </Button>
      </footer>
      <ScrollHint targetRef={footerRef} />

      <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
        <PopoverContent
          anchor={deleteAnchor}
          side="bottom"
          align="end"
          initialFocus={cancelFocusRef}
        >
          <PopoverTitle>Excluir conta?</PopoverTitle>
          <PopoverDescription>
            Todas as pessoas do grupo vão ver que a conta foi excluída.
          </PopoverDescription>
          <div className="flex gap-2">
            <Button
              ref={cancelFocusRef}
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={working}
              onClick={handleDelete}
            >
              Excluir
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {inviteParticipant?.guest && (
        <GuestInviteDialog
          open
          onOpenChange={(open) => {
            if (!open) setInviteIndex(null);
          }}
          guest={inviteParticipant.guest}
          shareCents={inviteParticipant.shareCents}
          expenseTitle={current.title}
          expenseId={expenseId}
        />
      )}
    </div>
  );
}
