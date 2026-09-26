"use client";

import { QrCode, Receipt, ScanLine, Search, Users, Zap } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { CounterpartyDialog } from "@/components/dashboard/counterparty-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DebtRowButton } from "@/components/dashboard/debt-row";
import {
  selectHomeMode,
  selectHomeRecentBills,
} from "@/components/dashboard/home-selectors";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NotificationPrompt } from "@/components/pwa/notification-prompt";
import { Logo } from "@/components/shared/logo";
import { Money } from "@/components/shared/money";
import { RefreshButton } from "@/components/shared/refresh-button";
import { useScreenHeaderActions, useScreenRefresh } from "@/components/shared/screen-header-actions";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { AmountHeroCard } from "@/components/shared/amount-hero-card";
import { displayNames } from "@/lib/people";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { haptics } from "@/hooks/use-haptics";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  DashboardSkeleton,
  ModalLoadingSkeleton,
} from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { selectDebtRows, type DebtRow } from "@/lib/ledger/debt-rows";
import { ledgerErrorMessage, LedgerError } from "@/lib/sync/errors";
import { recordSettlement } from "@/lib/sync/mutations";
import { retryNudgeDispatch, sendNudge } from "@/lib/sync/mutations-group";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> }
);

const QuickChargeModal = dynamic(
  () =>
    import("@/components/dashboard/quick-charge-modal").then((m) => ({
      default: m.QuickChargeModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> }
);

const quickActionClass =
  "h-auto min-h-14 flex-col gap-1 rounded-[0.75rem] px-2 py-2 text-xs whitespace-nowrap md:min-h-10 md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm";

export function DashboardContent() {
  const me = useMe();
  const hydrated = useAppStore((state) => state.hydrated);
  const rows = useAppStore(selectDebtRows);
  const homeMode = useAppStore(selectHomeMode);
  const recentBills = useAppStore(selectHomeRecentBills);
  const [selectedDebt, setSelectedDebt] = useState<DebtRow | null>(null);
  const [debtAnchor, setDebtAnchor] = useState<HTMLElement | null>(null);
  /**
   * Reminder lifecycle per counterparty, keyed `${groupId}:${counterpartyId}`.
   * Session-scoped on purpose: the RPC's 24h cooldown is the real authority,
   * this only stops the button from looking idle after it fired.
   */
  const [nudgeStates, setNudgeStates] = useState<
    Record<string, "sending" | "sent">
  >({});

  const selectDebt = (row: DebtRow, anchor: HTMLButtonElement) => {
    setDebtAnchor(anchor);
    setSelectedDebt(row);
  };
  const [pixTarget, setPixTarget] = useState<{
    debt: DebtRow;
    mode: "pay" | "collect";
  } | null>(null);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);
  const [quickChargeAnchor, setQuickChargeAnchor] =
    useState<HTMLElement | null>(null);
  const [missingKeyOpen, setMissingKeyOpen] = useState(false);

  const owes = rows.filter((row) => row.direction === "owes");
  const owed = rows.filter((row) => row.direction === "owed");
  const owesTotal = owes.reduce((sum, row) => sum + row.amountCents, 0);
  const owedTotal = owed.reduce((sum, row) => sum + row.amountCents, 0);
  const net = owedTotal - owesTotal;
  const names = useMemo(
    () =>
      displayNames(
        rows.map((row) => ({
          id: row.counterpartyId,
          name: row.counterpartyName,
          handle: row.counterpartyHandle,
        })),
        { style: "full" }
      ),
    [rows]
  );

  const headerActions = useScreenHeaderActions();
  const screenRefresh = useScreenRefresh();
  if (!hydrated || !me) {
    return (
      <div className="px-4 py-6">
        <DashboardSkeleton />
      </div>
    );
  }

  const handleMarkPaid = async (amountCents: number, operationId: string) => {
    if (!me || !pixTarget) throw new LedgerError("unauthenticated");
    const { debt, mode } = pixTarget;
    await recordSettlement({
      groupId: debt.groupId,
      operationId,
      fromUserId: mode === "pay" ? me.id : debt.counterpartyId,
      toUserId: mode === "pay" ? debt.counterpartyId : me.id,
      amountCents,
    });
  };

  const handleNudge = async (groupId: string, counterpartyId: string) => {
    const key = `${groupId}:${counterpartyId}`;
    const settle = (state: "sending" | "sent" | null) =>
      setNudgeStates((current) => {
        if (state !== null) return { ...current, [key]: state };
        if (current[key] === undefined) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });

    settle("sending");
    try {
      const { ack, delivery } = await sendNudge(groupId, counterpartyId);
      if (delivery === "delivered") {
        settle("sent");
        toast.success("Lembrete enviado");
        return;
      }
      if (delivery === "suppressed") {
        settle("sent");
        toast.success("Lembrete registrado");
        return;
      }
      if (delivery === "unavailable") {
        settle(null);
        toast.error("A outra pessoa não tem notificações ativas.");
        return;
      }

      const eventId = ack.eventId;
      if (eventId === null) {
        settle(null);
        toast.error("Não conseguimos entregar o lembrete.");
        return;
      }

      settle(null);
      toast.error(
        (t) => (
          <span className="flex items-center gap-3">
            Não conseguimos entregar o lembrete.
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => {
                toast.dismiss(t.id);
                void retryNudgeDispatch(eventId).then((result) => {
                  if (result === "delivered") {
                    settle("sent");
                    toast.success("Lembrete enviado");
                  } else if (result === "suppressed") {
                    settle("sent");
                    toast.success("Lembrete registrado");
                  } else if (result === "unavailable") {
                    toast.error("A outra pessoa não tem notificações ativas.");
                  } else {
                    toast.error("Ainda não conseguimos entregar.");
                  }
                });
              }}
            >
              Tentar de novo
            </button>
          </span>
        ),
        { duration: 8000 }
      );
    } catch (error) {
      // A cooldown means today's reminder already went out, so the button
      // must stay spent rather than invite a second pointless attempt.
      settle(
        error instanceof LedgerError && error.code === "nudge_cooldown"
          ? "sent"
          : null
      );
      toast.error(ledgerErrorMessage(error));
    }
  };

  const openPay = (row: DebtRow) => {
    setSelectedDebt(null);
    setPixTarget({ debt: row, mode: "pay" });
  };

  const openCollect = (row: DebtRow) => {
    setSelectedDebt(null);
    setPixTarget({ debt: row, mode: "collect" });
  };

  const openQuickCharge = (event: React.MouseEvent<HTMLButtonElement>) => {
    haptics.tap();
    setQuickChargeAnchor(event.currentTarget);
    setSelectedDebt(null);
    if (!me.pixKeyHint) {
      setMissingKeyOpen(true);
      return;
    }
    setQuickChargeOpen(true);
  };

  const firstName = me.name.split(" ")[0] ?? me.name;
  let balanceLabel = "Tudo acertado";
  if (net > 0) balanceLabel = "A receber no total";
  else if (net < 0) balanceLabel = "Você deve no total";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-8 compact:space-y-3">
      <header className="flex items-center justify-between pt-4 compact:pt-2">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          {screenRefresh && (
            <RefreshButton refreshing={screenRefresh.refreshing} onRefresh={screenRefresh.refresh} />
          )}
          <IconButton
            nativeButton={false}
            role="link"
            render={<Link href="/app/search" />}
            aria-label="Buscar"
          >
            <Search className="size-5" aria-hidden="true" />
          </IconButton>
          {headerActions}
        </div>
      </header>
      <div className="flex items-center gap-3">
        <Link
          href="/app/profile"
          aria-label="Seu perfil"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <UserAvatar
            id={me.id}
            name={me.name}
            avatarUrl={me.avatarUrl}
            size="sm"
            priority
            isBot={me.isBot}
          />
        </Link>
        <h1 className="min-w-0 break-words text-lg font-semibold">
          Oi, {firstName}
        </h1>
      </div>
      <section
        aria-label="Seu saldo"
        className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_12rem] md:gap-3 md:space-y-0"
      >
        <AmountHeroCard
          data-tour="balance-card"
          label={balanceLabel}
          cents={net}
          tone="auto"
          details={homeMode === "first-use" ? [] : [
            { label: "A pagar", value: <Money cents={owesTotal} size="sm" tone={owesTotal > 0 ? "negative" : "neutral"} /> },
            { label: "A receber", value: <Money cents={owedTotal} size="sm" tone={owedTotal > 0 ? "positive" : "neutral"} /> },
          ]}
        />
        <div
          className="grid grid-cols-3 gap-2 md:grid-cols-1 md:content-start"
          data-tour="quick-actions"
        >
          <Button
            variant="secondary"
            className={quickActionClass}
            onClick={openQuickCharge}
          >
            <Zap className="size-4 text-primary" aria-hidden="true" />
            Cobrar rápido
          </Button>
          <Button
            nativeButton={false}
            role="link"
            render={<Link href="/app/bill/new?scan=true" />}
            variant="secondary"
            onClick={() => haptics.tap()}
            className={quickActionClass}
          >
            <ScanLine className="size-4 text-primary" aria-hidden="true" />
            Escanear nota
          </Button>
          <Button
            nativeButton={false}
            role="link"
            render={<Link href="/app/scan-invite" />}
            variant="secondary"
            onClick={() => haptics.tap()}
            className={quickActionClass}
          >
            <QrCode className="size-4 text-primary" aria-hidden="true" />
            Entrar em sala
          </Button>
        </div>
      </section>
      <InstallPrompt variant="card" />
      <NotificationPrompt />

      <div className="space-y-6 empty:hidden" data-tour="debt-lists">
        {homeMode === "first-use" ? (
          <SectionCard className="space-y-3 p-5 text-center">
            <Users
              className="mx-auto size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold">
              As contas começam em grupo
            </h2>
            <Button
              nativeButton={false}
              role="link"
              render={<Link href="/app/groups" />}
            >
              Criar ou entrar num grupo
            </Button>
          </SectionCard>
        ) : homeMode === "settled" ? null : (
          <>
            {owes.length > 0 && (
              <section>
                <SectionHeading
                  title="A pagar"
                  trailing={<Money cents={owesTotal} tone="negative" />}
                />
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-border overflow-hidden rounded-2xl border bg-card"
                >
                  {owes.map((row, index) => (
                    <motion.div
                      key={`${row.groupId}-${row.counterpartyId}`}
                      variants={index < 6 ? staggerItem : undefined}
                    >
                      <DebtRowButton
                        row={row}
                        displayName={names.get(row.counterpartyId)}
                        onSelect={selectDebt}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </section>
            )}

            {owed.length > 0 && (
              <section>
                <SectionHeading
                  title="A receber"
                  trailing={<Money cents={owedTotal} tone="positive" />}
                />
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-border overflow-hidden rounded-2xl border bg-card"
                >
                  {owed.map((row, index) => (
                    <motion.div
                      key={`${row.groupId}-${row.counterpartyId}`}
                      variants={
                        index + owes.length < 6 ? staggerItem : undefined
                      }
                    >
                      <DebtRowButton
                        row={row}
                        displayName={names.get(row.counterpartyId)}
                        onSelect={selectDebt}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </section>
            )}
          </>
        )}
      </div>

      {recentBills.length > 0 && (
        <section>
          <SectionHeading
            title="Contas recentes"
            trailing={
              <Link
                href="/app/bills"
                className="-my-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-primary-text hover:underline focus-visible:ring-3 focus-visible:ring-ring"
              >
                Ver todas
              </Link>
            }
          />
          <SectionCard>
            {recentBills.map((bill) => (
              <ListRow
                key={bill.id}
                href={`/app/bill/${bill.id}`}
                title={bill.title}
                subtitle={[bill.groupName, bill.occurredOn]
                  .filter(Boolean)
                  .join(" · ")}
                leading={
                  <Receipt
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                }
                trailing={<Money cents={bill.totalCents} size="sm" />}
              />
            ))}
          </SectionCard>
        </section>
      )}

      {selectedDebt && (
        <CounterpartyDialog
          row={selectedDebt}
          displayName={names.get(selectedDebt.counterpartyId)}
          meId={me.id}
          open
          onClose={() => setSelectedDebt(null)}
          anchor={debtAnchor}
          onPay={openPay}
          onCollect={openCollect}
          nudgeState={
            nudgeStates[
              `${selectedDebt.groupId}:${selectedDebt.counterpartyId}`
            ] ?? "idle"
          }
          onNudge={(row) => {
            void handleNudge(row.groupId, row.counterpartyId);
          }}
        />
      )}

      {quickChargeOpen && (
        <QuickChargeModal
          open
          onClose={() => setQuickChargeOpen(false)}
          anchor={quickChargeAnchor}
        />
      )}

      <Dialog open={missingKeyOpen} onOpenChange={setMissingKeyOpen}>
        <DialogContent className="rounded-xl bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
            <QrCode className="size-6" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base font-bold">
              Pra receber, você precisa de uma chave Pix.
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Leva um minuto, e só quem recebe precisa dela.
            </DialogDescription>
          </div>
          <div className="space-y-2">
            <Link
              href="/app/profile"
              className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Cadastrar agora
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {pixTarget && (
        <PixQrModal
          open
          onClose={() => setPixTarget(null)}
          recipientName={names.get(pixTarget.debt.counterpartyId) ?? pixTarget.debt.counterpartyName}
          counterpartyId={pixTarget.debt.counterpartyId}
          counterpartyAvatarUrl={pixTarget.debt.counterpartyAvatarUrl}
          recipientUserId={
            pixTarget.mode === "pay" ? pixTarget.debt.counterpartyId : me.id
          }
          groupId={pixTarget.debt.groupId}
          mode={pixTarget.mode}
          onMarkPaid={handleMarkPaid}
        />
      )}
    </div>
  );
}
