"use client";

import { UserX } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { JSX } from "react";
import {
  PersonProfileView,
  type SharedSpendingView,
} from "@/components/person/person-profile-view";
import { Button } from "@/components/ui/button";
import { personDebtRows, selectDebtRows } from "@/lib/ledger/debt-rows";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { refreshSharedSpending } from "@/lib/sync/refresh";
import { selectKnownUser, sharedGroupsWith } from "@/stores/app-selectors";
import { IDLE_READ, sharedSpendingReadKey, useAppStore } from "@/stores/app-store";

export interface PersonProfileProps {
  userId: string;
  onBack: () => void;
  onMessage: () => void;
  messagePending?: boolean;
  heroLayoutId?: string;
}

export function PersonProfile({
  userId,
  onBack,
  onMessage,
  messagePending = false,
  heroLayoutId,
}: PersonProfileProps): JSX.Element | null {
  const me = useAppStore((s) => s.me);
  const person = useAppStore((s) => selectKnownUser(s, userId));
  const blocked = useAppStore((s) => s.blockedUsers.some((user) => user.id === userId));
  const debtRows = useAppStore(selectDebtRows);
  const groups = useAppStore((s) => s.groups);
  const groupOrder = useAppStore((s) => s.groupOrder);
  const spending = useAppStore((s) => s.sharedSpending[userId]);
  const read = useAppStore((s) => s.reads[sharedSpendingReadKey(userId)] ?? IDLE_READ);

  const known = person !== null;
  useEffect(() => {
    if (!known) return;
    void refreshSharedSpending(userId).catch(() => {});
  }, [known, userId]);

  const meId = me?.id ?? null;
  const sharedGroups = useMemo(
    () => (meId === null ? [] : sharedGroupsWith(groups, groupOrder, meId, userId)),
    [meId, groups, groupOrder, userId],
  );
  const balance = useMemo(() => personDebtRows(debtRows, userId), [debtRows, userId]);

  if (me === null) return null;

  if (person === null) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-20 text-center md:max-w-2xl">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <UserX className="size-6" />
        </span>
        <p className="text-base font-semibold">Não encontramos esse perfil.</p>
        <Button size="lg" onClick={onBack}>
          Voltar
        </Button>
      </div>
    );
  }

  let spendingView: SharedSpendingView;
  if (spending !== undefined) {
    spendingView = { status: "ready", spending };
  } else if (read.status === "error") {
    spendingView = { status: "error", message: ledgerErrorMessage(new LedgerError(read.code)) };
  } else {
    spendingView = { status: "loading" };
  }

  return (
    <PersonProfileView
      person={person}
      meId={me.id}
      blocked={blocked}
      balance={balance}
      sharedGroups={sharedGroups}
      spending={spendingView}
      onRetrySpending={() => {
        void refreshSharedSpending(userId).catch(() => {});
      }}
      onBack={onBack}
      onMessage={onMessage}
      messagePending={messagePending}
      heroLayoutId={heroLayoutId}
    />
  );
}
