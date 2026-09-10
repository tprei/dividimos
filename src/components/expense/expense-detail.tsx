"use client";

import { motion } from "framer-motion";
import { Check, Pencil, Receipt, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ExpenseHistory } from "./expense-history";
import { ExpenseItems } from "./expense-items";
import { ExpenseParticipantList } from "./expense-participant-list";
import { GuestInviteDialog } from "./guest-invite-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMe } from "@/hooks/use-me";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { deleteExpense, restoreExpense } from "@/lib/sync/mutations";
import { refreshExpense } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";

export function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const me = useMe();
  const detail = useAppStore((s) => s.expenseDetails[expenseId]);
  const snapshot = useAppStore((s) =>
    detail ? s.groups[detail.group.id] : undefined,
  );

  const [unavailable, setUnavailable] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [inviteIndex, setInviteIndex] = useState<number | null>(null);
  const inviteParticipant =
    inviteIndex === null
      ? null
      : detail?.participants.find((p) => p.participantIndex === inviteIndex) ?? null;

  useEffect(() => {
    let cancelled = false;
    setUnavailable(false);
    refreshExpense(expenseId).catch((error: unknown) => {
      if (cancelled) return;
      if (
        error instanceof LedgerError &&
        (error.code === "expense_not_found" || error.code === "not_a_member")
      ) {
        setUnavailable(true);
        return;
      }
      toast.error(ledgerErrorMessage(error));
    });
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

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
  const isDeleted = expense.status === "deleted";

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

        <div className="mt-4 flex gap-2">
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
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            </>
          )}
        </div>
      </div>

      <ExpenseParticipantList
        participants={detail.participants}
        meId={me?.id ?? null}
        invitedUserIds={invitedUserIds}
        onInviteGuest={(participant) => setInviteIndex(participant.participantIndex)}
      />

      {current.expenseType === "itemized" &&
        current.payload.items.length > 0 && (
          <div className="px-4">
            <ExpenseItems
              items={current.payload.items}
              itemAssignments={current.payload.itemAssignments}
              participantName={participantName}
            />
          </div>
        )}

      <div className="px-4">
        <ExpenseHistory
          versions={detail.versions}
          nameOf={nameOf}
          avatarUrlOf={avatarUrlOf}
        />
      </div>

      <footer className="safe-bottom sticky bottom-0 mt-6 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full text-base font-bold"
          onClick={() => router.push("/app")}
        >
          Pronto
        </Button>
      </footer>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir conta?</DialogTitle>
            <DialogDescription>
              Todas as pessoas do grupo vão ver que a conta foi excluída.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={working}
              onClick={handleDelete}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
