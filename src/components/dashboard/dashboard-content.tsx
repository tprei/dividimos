"use client";

import { Bell, Plus, ScanLine, Search, Zap } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import toast from "react-hot-toast";
import { CounterpartyDialog } from "@/components/dashboard/counterparty-dialog";
import { DebtRowButton } from "@/components/dashboard/debt-row";
import { NotificationsSheet } from "@/components/dashboard/notifications-sheet";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  DashboardSkeleton,
  ModalLoadingSkeleton,
} from "@/components/shared/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { selectDebtRows, type DebtRow } from "@/lib/ledger/debt-rows";
import { ledgerErrorMessage, LedgerError } from "@/lib/sync/errors";
import { recordSettlement } from "@/lib/sync/mutations";
import { sendNudge } from "@/lib/sync/mutations-group";
import { useMe } from "@/hooks/use-me";
import { selectPendingInvitations } from "@/stores/app-selectors";
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
  const hydrated = useAppStore((state) => state.hydrated);
  const rows = useAppStore(selectDebtRows);
  const invitations = useAppStore(selectPendingInvitations);
  const [selectedDebt, setSelectedDebt] = useState<DebtRow | null>(null);
  const [pixTarget, setPixTarget] = useState<{
    debt: DebtRow;
    mode: "pay" | "collect";
  } | null>(null);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  if (!hydrated || !me) {
    return (
      <div className="px-4 py-6">
        <DashboardSkeleton />
      </div>
    );
  }

  const owes = rows.filter((row) => row.direction === "owes");
  const owed = rows.filter((row) => row.direction === "owed");
  const owesTotal = owes.reduce((sum, row) => sum + row.amountCents, 0);
  const owedTotal = owed.reduce((sum, row) => sum + row.amountCents, 0);
  const net = owedTotal - owesTotal;

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
      await sendNudge(groupId, counterpartyId);
      toast.success("Lembrete enviado");
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
    setQuickChargeOpen(true);
  };

  const firstName = me.name.split(" ")[0] ?? me.name;

  return (
    <div className="mx-auto max-w-lg pb-8">
      <ScreenHeader
        title={`Oi, ${firstName}`}
        action={
          <div className="flex items-center gap-1">
            <InstallPrompt />
            <Button
              variant="ghost"
              size="icon-lg"
              className="min-h-11 min-w-11 rounded-full"
              render={<Link href="/app/search" aria-label="Buscar" />}
            >
              <Search className="size-5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              className="relative min-h-11 min-w-11 rounded-full"
              aria-label={`Notificações${invitations.length > 0 ? `, ${invitations.length} não lidas` : ""}`}
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell className="size-5" aria-hidden="true" />
              {invitations.length > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white"
                >
                  {invitations.length}
                </span>
              )}
            </Button>
          </div>
        }
      />

      <div className="px-4 pt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Saldo geral
        </p>
        <Money
          cents={net}
          signed
          className="text-4xl"
          label={`Saldo geral ${formatBRL(net)}`}
        />
        <div className="mt-3 flex gap-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              A pagar
            </p>
            <Money cents={owesTotal} className="text-destructive" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              A receber
            </p>
            <Money cents={owedTotal} className="text-success" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Link
            href="/app/bill/new?scan=true"
            className={buttonVariants({
              variant: "outline",
              className: "h-11 min-w-0 flex-1",
            })}
          >
            <ScanLine className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Escanear nota</span>
          </Link>
          <Link
            href="/app/bill/new"
            className={buttonVariants({
              variant: "outline",
              className: "h-11 min-w-0 flex-1",
            })}
          >
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Nova conta</span>
          </Link>
          <Button
            variant="outline"
            className="h-11 min-w-0 flex-1"
            onClick={openQuickCharge}
            disabled={!me.pixKeyHint}
            title={me.pixKeyHint ? undefined : "Cadastre uma chave Pix no perfil"}
          >
            <Zap className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Cobrar rápido</span>
          </Button>
        </div>
      </div>

      <div className="space-y-6 px-4 pt-7">
        <section>
          <SectionHeading
            title="A pagar"
            trailing={<Money cents={owesTotal} className="text-destructive" />}
          />
          <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
            {owes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Tudo em dia</p>
            ) : (
              owes.map((row) => (
                <DebtRowButton
                  key={`${row.groupId}-${row.counterpartyId}`}
                  row={row}
                  onSelect={setSelectedDebt}
                />
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading
            title="A receber"
            trailing={<Money cents={owedTotal} className="text-success" />}
          />
          <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
            {owed.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Tudo em dia</p>
            ) : (
              owed.map((row) => (
                <DebtRowButton
                  key={`${row.groupId}-${row.counterpartyId}`}
                  row={row}
                  onSelect={setSelectedDebt}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <NotificationsSheet
        open={notificationsOpen}
        onOpenChange={setNotificationsOpen}
        invitations={invitations}
        meId={me.id}
      />

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
