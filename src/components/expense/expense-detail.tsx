"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Pencil,
  Receipt,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ExpenseHistory } from "./expense-history";
import { ExpenseItems } from "./expense-items";
import { ExpenseParticipants } from "./expense-participants";
import { EmptyState } from "@/components/shared/empty-state";
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
import { formatBRL } from "@/lib/currency";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { deleteExpense, restoreExpense } from "@/lib/sync/mutations";
import { refreshExpense } from "@/lib/sync/refresh";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";

function formatDateBR(occurredOn: string): string {
  const [year, month, day] = occurredOn.split("-");
  return day && month && year ? `${day}/${month}/${year}` : occurredOn;
}

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

  const groupHref = useMemo(() => {
    if (!detail) return "/app";
    const group = snapshot?.group;
    if (group && detail.group.kind === "dm") {
      const counterparty =
        group.dmUserA === me?.id ? group.dmUserB : group.dmUserA;
      if (counterparty) return `/app/conversations/${counterparty}`;
    }
    return `/app/groups/${detail.group.id}`;
  }, [detail, snapshot, me]);

  if (unavailable) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-semibold">Despesa</h1>
        </div>
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
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{current.title}</h1>
          {current.merchantName && (
            <p className="truncate text-xs text-muted-foreground">
              {current.merchantName}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {formatDateBR(current.occurredOn)}
            </span>
            <Link
              href={groupHref}
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Users className="h-3 w-3" />
              {detail.group.name}
            </Link>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Total da despesa</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatBRL(current.totalCents)}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-white/70">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {detail.participants.length} pessoas
            </span>
            {current.expenseType === "itemized" && (
              <span className="flex items-center gap-1">
                <Receipt className="h-3.5 w-3.5" />
                {current.payload.items.length} itens
              </span>
            )}
          </div>
        </div>
      </motion.div>

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

      <ExpenseParticipants
        participants={detail.participants}
        participantName={participantName}
        expenseTitle={current.title}
      />

      {current.expenseType === "itemized" &&
        current.payload.items.length > 0 && (
          <ExpenseItems
            items={current.payload.items}
            itemAssignments={current.payload.itemAssignments}
            participantName={participantName}
          />
        )}

      <ExpenseHistory
        versions={detail.versions}
        nameOf={nameOf}
        avatarUrlOf={avatarUrlOf}
      />

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
    </div>
  );
}
