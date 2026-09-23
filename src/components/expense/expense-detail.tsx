"use client";

import { motion } from "framer-motion";
import { Check, Pencil, Receipt, RotateCcw, Trash2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const [inviteIndex, setInviteIndex] = useState<number | null>(null);
  const [inviteAnchor, setInviteAnchor] = useState<HTMLElement | null>(null);
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
          title="Despesa"
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
        <ScreenHeader back title="Despesa" />
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

  async function handleDelete() {
    setWorking(true);
    try {
      await deleteExpense(expenseId);
      toast.success("Conta excluída");
      setConfirmOpen(false);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function handleRestore() {
    setWorking(true);
    try {
      await restoreExpense(expenseId);
      toast.success("Conta restaurada");
    } catch (error) {
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
      onInviteGuest={(participant, anchor) => {
        setInviteIndex(participant.participantIndex);
        setInviteAnchor(anchor);
      }}
    />
  );
  const items = current.expenseType === "itemized" &&
    current.payload.items.length > 0 ? (
      <ExpenseItems
        items={current.payload.items}
        itemAssignments={current.payload.itemAssignments}
        participantName={participantName}
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
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col">
      <ScreenHeader
        back
        title={current.title}
        action={
          <div
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-success/15 text-success"
          >
            <Check className="size-5" />
          </div>
        }
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="border-b px-4 pb-4"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Total
        </p>
        <Money cents={current.totalCents} className="text-4xl font-semibold" />
      </motion.div>

      <div className="px-4">
        {isDeleted && (
          <div className="mt-4 rounded-2xl border-2 border-dashed border-warning/30 bg-warning/5 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <Trash2 className="h-4 w-4" />
              Conta excluída
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Essa conta foi excluída e não entra nos saldos do grupo.
            </p>
          </div>
        )}

        {canManage && (
          <div className="mt-4 flex gap-2 [&>button]:min-h-11 [&>button]:min-w-0 [&>button]:flex-1">
            {isDeleted ? (
              <Button
                className="flex-1 gap-2"
                disabled={working}
                onClick={handleRestore}
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => router.push(`/app/bill/new?edit=${expenseId}`)}
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-2 text-destructive hover:text-destructive"
                  onClick={(event) => {
                    setDeleteAnchor(event.currentTarget);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </Button>
              </>
            )}
            {assignmentRoom && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => router.push(`/room/${assignmentRoom.id}`)}
              >
                <Receipt className="h-4 w-4" />
                Ver sala
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="px-4">
        <ExpensePayers
          payers={payers}
          participantName={participantName}
          participantAvatarUrl={participantAvatarUrl}
          participantIsGuest={participantIsGuest}
        />
      </div>

      {assignmentRoom ? (
        <section className="mt-5 px-4" aria-label="Sala de itens">
          <h2 className="text-sm font-semibold">Sala de itens</h2>
          <Tabs key={expenseId} defaultValue="people" className="mt-3 gap-4">
            <TabsList
              variant="line"
              aria-label="Sala de itens"
              className="w-full justify-start gap-0 border-b p-0 group-data-horizontal/tabs:h-11"
            >
              {[
                ["items", "Por item"],
                ["people", "Por pessoa"],
                ["history", "Histórico"],
              ].map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-11 flex-none rounded-none px-3 after:bg-primary group-data-horizontal/tabs:after:bottom-0 motion-reduce:transition-none motion-reduce:after:transition-none"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="items">{items}</TabsContent>
            <TabsContent value="people">{participantList}</TabsContent>
            <TabsContent value="history">{history}</TabsContent>
          </Tabs>
        </section>
      ) : (
        <>
          {participantList}
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
          anchor={inviteAnchor}
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
