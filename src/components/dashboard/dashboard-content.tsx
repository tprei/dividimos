"use client";

import { ChevronRight, Plus, QrCode, Receipt, ScanLine, Search, Zap } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CounterpartyDialog } from "@/components/dashboard/counterparty-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DebtRowButton } from "@/components/dashboard/debt-row";
import { selectHomeMode, selectRecentBills } from "@/components/dashboard/home-selectors";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Logo } from "@/components/shared/logo";
import { Money } from "@/components/shared/money";
import { useScreenHeaderActions } from "@/components/shared/screen-header-actions";
import { ScreenHeader } from "@/components/shared/screen-header";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  DashboardSkeleton,
  ModalLoadingSkeleton,
} from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/currency";
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
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

const QuickChargeModal = dynamic(
  () =>
    import("@/components/dashboard/quick-charge-modal").then((m) => ({
      default: m.QuickChargeModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

export function DashboardContent() {
  const me = useMe();
  const expenses = useAppStore((state) => state.expenses);
  const groups = useAppStore((state) => state.groups);
  const myExpenses = useAppStore((state) => state.myExpenses);
  const hydrated = useAppStore((state) => state.hydrated);
  const rows = useAppStore(selectDebtRows);
  const homeMode = useAppStore(selectHomeMode);
  const recentBills = useMemo(
    () => selectRecentBills({ expenses, groups, me, myExpenses }, 3),
    [expenses, groups, me, myExpenses],
  );
  const [selectedDebt, setSelectedDebt] = useState<DebtRow | null>(null);
  const [pixTarget, setPixTarget] = useState<{
    debt: DebtRow;
    mode: "pay" | "collect";
  } | null>(null);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);
  const [missingKeyOpen, setMissingKeyOpen] = useState(false);

  const owes = rows.filter((row) => row.direction === "owes");
  const owed = rows.filter((row) => row.direction === "owed");
  const owesTotal = owes.reduce((sum, row) => sum + row.amountCents, 0);
  const owedTotal = owed.reduce((sum, row) => sum + row.amountCents, 0);
  const net = owedTotal - owesTotal;

  const headerActions = useScreenHeaderActions();
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
    try {
      const { ack, delivery } = await sendNudge(groupId, counterpartyId);
      if (delivery === "delivered") {
        toast.success("Lembrete enviado");
        return;
      }
      if (delivery === "suppressed") {
        toast.success("Lembrete registrado");
        return;
      }
      if (delivery === "unavailable") {
        toast.error("A outra pessoa não tem notificações ativas.");
        return;
      }

      const eventId = ack.eventId;
      if (eventId === null) {
        toast.error("Não conseguimos entregar o lembrete.");
        return;
      }

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
                    toast.success("Lembrete enviado");
                  } else if (result === "suppressed") {
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
        { duration: 8000 },
      );
    } catch (error) {
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

  const openQuickCharge = () => {
    setSelectedDebt(null);
    if (!me?.pixKeyHint) {
      setMissingKeyOpen(true);
      return;
    }
    setQuickChargeOpen(true);
  };

  const firstName = me.name.split(" ")[0] ?? me.name;

  return (
    <div className="mx-auto max-w-lg pb-8">
      <div className="flex items-center justify-between px-4 pt-4">
        <Logo size="sm" />
        <div className="-mr-2 flex items-center gap-1.5">
          <InstallPrompt />
          <Link
            href="/app/search"
            aria-label="Buscar"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-lg" }),
              "min-h-11 min-w-11 rounded-full",
            )}
          >
            <Search className="size-5" aria-hidden="true" />
          </Link>
          {headerActions}
        </div>
      </div>
      <ScreenHeader
        title={`Oi, ${firstName}`}
        leading={
          <Link
            href="/app/profile"
            aria-label="Seu perfil"
            className="shrink-0 rounded-full ring-2 ring-primary/25 transition-shadow hover:ring-primary/50"
          >
            <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size="md" priority isBot={me.isBot} />
          </Link>
        }
      />

      <div
        className="gradient-mesh mx-4 mt-2 flex items-start gap-4 rounded-3xl border border-primary/15 p-4"
      >
        <div className="min-w-0 flex-1 overflow-hidden" data-tour="balance-card">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Saldo geral
          </p>
          <Money
            cents={net}
            signed
            className="block text-[28px] leading-tight"
            label={`Saldo geral ${formatBRL(net)}`}
          />
          {homeMode !== "first-use" && (
            <div className="mt-4 flex gap-8">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  A pagar
                </p>
                <Money
                  cents={owesTotal}
                  className={owesTotal > 0 ? "text-destructive" : "text-muted-foreground"}
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  A receber
                </p>
                <Money cents={owedTotal} className="text-success" />
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2" data-tour="quick-actions">
            <Link
              href="/app/bill/new?scan=true"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-11 justify-start px-3 text-xs",
                "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10",
              )}
            >
              <ScanLine className="size-4 shrink-0 text-primary" aria-hidden="true" />
              Escanear nota
            </Link>
            <Link
              href="/app/bill/new"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-11 justify-start px-3 text-xs",
                "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10",
              )}
            >
              <Plus className="size-4 shrink-0 text-primary" aria-hidden="true" />
              Nova conta
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 justify-start px-3 text-xs border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10"
              onClick={openQuickCharge}
            >
              <Zap className="size-4 shrink-0" aria-hidden="true" />
              Cobrar rápido
            </Button>
          </div>
      </div>

      <div className="space-y-6 px-4 pt-7" data-tour="debt-lists">
        {homeMode === "first-use" ? (
          <div className="rounded-2xl border bg-card p-5 text-center">
            <h2 className="text-base font-semibold">Comece por aqui</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Crie uma conta pra rachar ou entre num grupo pelo convite.
            </p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <Link
                href="/app/bill/new"
                className={cn(buttonVariants({ variant: "default" }), "min-h-11 rounded-lg gap-2 font-medium")}
              >
                <Plus className="size-4" />
                Nova conta
              </Link>
              <Link
                href="/app/scan-invite"
                className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-lg gap-2 font-medium")}
              >
                <QrCode className="size-4" />
                Ler convite
              </Link>
            </div>
          </div>
        ) : homeMode === "settled" ? (
          <div className="rounded-2xl border bg-card p-5">
            <p className="text-sm font-medium text-foreground">Tudo em dia por aqui</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Nenhuma pendência no momento.</p>
          </div>
        ) : (
          <>
            {owes.length > 0 && (
              <section>
                <SectionHeading
                  title="A pagar"
                  trailing={
                    <Money
                      cents={owesTotal}
                      className={owesTotal > 0 ? "text-destructive" : "text-muted-foreground"}
                    />
                  }
                />
                <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
                  {owes.map((row) => (
                    <DebtRowButton
                      key={`${row.groupId}-${row.counterpartyId}`}
                      row={row}
                      onSelect={setSelectedDebt}
                    />
                  ))}
                </div>
              </section>
            )}

            {owed.length > 0 && (
              <section>
                <SectionHeading
                  title="A receber"
                  trailing={<Money cents={owedTotal} className="text-success" />}
                />
                <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
                  {owed.map((row) => (
                    <DebtRowButton
                      key={`${row.groupId}-${row.counterpartyId}`}
                      row={row}
                      onSelect={setSelectedDebt}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {recentBills.length > 0 && (
        <section className="px-4 pt-7">
          <SectionHeading
            title="Contas recentes"
            trailing={
              <Link
                href="/app/bills"
                className="-my-2 -mr-1 inline-flex min-h-9 items-center rounded-md px-1 py-2 text-xs font-semibold text-primary hover:underline"
              >
                Ver todas
              </Link>
            }
          />
          <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
            {recentBills.map((bill) => (
              <Link
                key={bill.id}
                href={`/app/bill/${bill.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Receipt className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{bill.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[bill.occurredOn, bill.groupName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Money cents={bill.totalCents} className="text-sm font-medium" />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {selectedDebt && (
        <CounterpartyDialog
          row={selectedDebt}
          meId={me.id}
          open
          onClose={() => setSelectedDebt(null)}
          onPay={openPay}
          onCollect={openCollect}
          onNudge={(row) => {
            void handleNudge(row.groupId, row.counterpartyId);
          }}
        />
      )}

      {quickChargeOpen && (
        <QuickChargeModal
          open
          onClose={() => setQuickChargeOpen(false)}
        />
      )}

      <Dialog open={missingKeyOpen} onOpenChange={setMissingKeyOpen}>
        <DialogContent className="max-w-sm rounded-3xl bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
            <QrCode className="size-6" />
          </div>
          <DialogTitle className="mt-4 text-base font-bold">Pra receber, você precisa de uma chave Pix.</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Leva um minuto — e só quem recebe precisa dela.
          </DialogDescription>
          <div className="mt-6 space-y-2">
            <Link
              href="/app/profile"
              className="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Cadastrar agora
            </Link>
            <Button variant="ghost" className="w-full rounded-lg" size="lg" onClick={() => setMissingKeyOpen(false)}>
              Agora não
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {pixTarget && (
        <PixQrModal
          open
          onClose={() => setPixTarget(null)}
          recipientName={pixTarget.debt.counterpartyName}
          amountCents={pixTarget.debt.amountCents}
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
