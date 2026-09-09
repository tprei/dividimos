"use client";

import { Bell, Check, ChevronRight, Copy, Plus, QrCode, ScanLine } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import QRCode from "qrcode";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { generatePixCopiaECola } from "@/lib/pix";
import {
  CONVERSATIONS,
  DEBT_ROWS,
  HOME_NET_CENTS,
  HOME_OWED_CENTS,
  HOME_OWES_CENTS,
  ME,
  PEOPLE,
  PIX_KEYS,
} from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { BottomSheet } from "../ui/bottom-sheet";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";
import { SectionHeading } from "../ui/section-heading";

function Eyebrow({ children }: { children: string }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{children}</p>;
}

function CollectDialog({
  open,
  onClose,
  debtorName,
  amountCents,
}: {
  open: boolean;
  onClose: () => void;
  debtorName: string;
  amountCents: number;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copiaECola = generatePixCopiaECola({
    pixKey: PIX_KEYS[ME.id],
    merchantName: ME.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  const paintQr = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node) return;
      void QRCode.toCanvas(node, copiaECola, {
        width: 240,
        margin: 2,
        color: { dark: "#1a1d2e", light: "#ffffff" },
      });
    },
    [copiaECola],
  );

  async function handleCopy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(copiaECola);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      modal
    >
      <DialogContent className="w-full max-w-[calc(100%-2rem)] rounded-3xl bg-card p-5 sm:max-w-sm">
        <DialogTitle className="pr-8 text-lg font-bold">Cobrar de {debtorName}</DialogTitle>
        <DialogDescription>Mostre este QR para {debtorName} pagar.</DialogDescription>
        <div className="flex flex-col items-center">
          <Money cents={amountCents} className="text-3xl font-semibold" />
          <canvas
            ref={paintQr}
            className="mt-4 block size-60"
            aria-label={`Código QR Pix para cobrar de ${debtorName}`}
          />
          <div className="mt-4 flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-2">
            <UserAvatar name={ME.name} size="sm" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Recebendo em</p>
              <p className="truncate text-sm font-semibold">{ME.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{PIX_KEYS[ME.id]}</p>
            </div>
          </div>
          <Button variant="outline" className="mt-4 h-11 w-full" type="button" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="size-4 text-success" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copiar código Pix
              </>
            )}
          </Button>
          {copyError && (
            <p className="mt-2 text-center text-xs text-destructive" role="alert">
              Não foi possível copiar o código Pix.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


export function HomeScreen({ sheet, section }: ScreenProps) {
  const [openSheet, setOpenSheet] = useState<string | null>(sheet);
  const [selectedDebt, setSelectedDebt] = useState<DebtRow | null>(null);
  const owesRows = DEBT_ROWS.filter((row) => row.direction === "owes");
  const owedRows = DEBT_ROWS.filter((row) => row.direction === "owed");

  function debtForSheet(name: string | null, counterpartyId: string | null = null): DebtRow | null {
    let rows: DebtRow[] | null = null;
    if (name === "debt-owes" || name === "pix-pay") rows = owesRows;
    if (name === "debt-owed" || name === "pix-collect") rows = owedRows;
    if (!rows) return null;
    if (counterpartyId === null) return rows[0] ?? null;
    return rows.find((row) => row.counterpartyId === counterpartyId) ?? null;
  }

  const directSheet =
    sheet === "debt-owes" ||
    sheet === "debt-owed" ||
    sheet === "pix-pay" ||
    sheet === "pix-collect";
  const initialDebt = directSheet ? debtForSheet(sheet, section) : null;
  const activeDebt = selectedDebt ?? (directSheet ? initialDebt : debtForSheet(openSheet));
  const invalidSheetSelection =
    directSheet && section !== null && selectedDebt === null && initialDebt === null;
  const activeConversation = activeDebt
    ? CONVERSATIONS.find((conversation) => conversation.counterpartyId === activeDebt.counterpartyId)
    : null;


  return (
    <PreviewShell nav="home">
      <ScreenHeader
        title="Oi, Tiago"
        action={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Notificações"
            className="relative rounded-full"
            onClick={() => setOpenSheet("notifications")}
          >
            <Bell className="size-5" />
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              1
            </span>
          </Button>
        }
      />
      {invalidSheetSelection && (
        <div
          className="mx-4 mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2"
          role="alert"
        >
          <p className="text-sm font-semibold text-destructive">Seleção inválida</p>
          <p className="text-xs text-destructive">Não encontramos uma dívida para essa pessoa.</p>
        </div>
      )}
      <div className="px-4">
        <Eyebrow>Saldo geral</Eyebrow>
        <Money signed cents={HOME_NET_CENTS} className="text-4xl font-semibold" />
        <div className="mt-3 flex gap-8">
          <div>
            <Eyebrow>A pagar</Eyebrow>
            <Money cents={HOME_OWES_CENTS} className="font-semibold text-destructive" />
          </div>
          <div>
            <Eyebrow>A receber</Eyebrow>
            <Money cents={HOME_OWED_CENTS} className="font-semibold text-success" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="h-11 flex-1" type="button">
            <ScanLine className="size-4" />
            Escanear nota
          </Button>
          <Button variant="outline" className="h-11 flex-1" type="button">
            <Plus className="size-4" />
            Nova conta
          </Button>
        </div>
      </div>
      <div className="space-y-6 px-4 pt-7 pb-8">
        <section>
          <SectionHeading title="A pagar" trailing={<Money cents={HOME_OWES_CENTS} />} />
          <div className="overflow-hidden rounded-2xl border bg-card divide-y divide-border">
            {owesRows.map((row) => (
              <button
                type="button"
                key={`${row.groupId}-${row.counterpartyId}`}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                onClick={() => {
                  setSelectedDebt(row);
                  setOpenSheet("debt-owes");
                }}
              >
                <UserAvatar name={row.counterpartyName} avatarUrl={row.counterpartyAvatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{row.counterpartyName.split(" ")[0]}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.groupName}</span>
                </span>
                <Money cents={row.amountCents} className="font-semibold text-destructive" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
        <section>
          <SectionHeading title="A receber" trailing={<Money cents={HOME_OWED_CENTS} />} />
          <div className="overflow-hidden rounded-2xl border bg-card divide-y divide-border">
            {owedRows.map((row) => (
              <button
                type="button"
                key={`${row.groupId}-${row.counterpartyId}`}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                onClick={() => {
                  setSelectedDebt(row);
                  setOpenSheet("debt-owed");
                }}
              >
                <UserAvatar name={row.counterpartyName} avatarUrl={row.counterpartyAvatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{row.counterpartyName.split(" ")[0]}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.groupName}</span>
                </span>
                <Money cents={row.amountCents} className="font-semibold text-success" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>
      <BottomSheet
        open={openSheet === "notifications"}
        onOpenChange={(open) => setOpenSheet(open ? "notifications" : null)}
        title="Notificações"
      >
        <div className="flex items-center gap-3">
          <UserAvatar name={PEOPLE.marina.name} avatarUrl={PEOPLE.marina.avatarUrl} size="sm" />
          <div>
            <p className="text-sm font-semibold">Convite · Apto 42</p>
            <p className="text-xs text-muted-foreground">Enviado por Marina</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="h-9 flex-1" type="button">Aceitar</Button>
          <Button variant="outline" className="h-9 flex-1" type="button">Recusar</Button>
        </div>
      </BottomSheet>
      <Dialog
        open={openSheet === "debt-owes"}
        onOpenChange={(isOpen) => setOpenSheet(isOpen ? "debt-owes" : null)}
        modal
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-3xl bg-card p-5 sm:max-w-sm">
          <DialogTitle className="pr-8 text-lg font-bold">
            {activeDebt?.counterpartyName.split(" ")[0] ?? "Carlos"}
          </DialogTitle>
          <DialogDescription>{activeDebt?.groupName ?? "Churras do Ap 42"}</DialogDescription>
          <div className="flex flex-col items-center">
            <Money cents={activeDebt?.amountCents ?? 5900} className="text-3xl font-semibold" />
            <div className="mt-5 w-full space-y-2">
              <Button className="h-12 w-full" type="button" onClick={() => setOpenSheet("pix-pay")}>
                <QrCode className="size-4" />
                Pagar via Pix
              </Button>
              {activeConversation ? (
                <Link
                  href={`/demo/mobile/chat?section=${activeConversation.id}`}
                  className={buttonVariants({ variant: "outline", className: "h-12 w-full" })}
                >
                  Abrir conversa
                </Link>
              ) : (
                <Button variant="outline" className="h-12 w-full" type="button" disabled>
                  Conversa indisponível
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={openSheet === "debt-owed"}
        onOpenChange={(isOpen) => setOpenSheet(isOpen ? "debt-owed" : null)}
        modal
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-3xl bg-card p-5 sm:max-w-sm">
          <DialogTitle className="pr-8 text-lg font-bold">
            {activeDebt?.counterpartyName.split(" ")[0] ?? "Dan"}
          </DialogTitle>
          <DialogDescription>{activeDebt?.groupName ?? "Viagem Ubatuba"}</DialogDescription>
          <div className="flex flex-col items-center">
            <Money cents={activeDebt?.amountCents ?? 4500} className="text-3xl font-semibold" />
            <div className="mt-5 w-full space-y-2">
              <Button className="h-12 w-full" type="button" onClick={() => setOpenSheet("pix-collect")}>
                <QrCode className="size-4" />
                Cobrar via Pix
              </Button>
              <Button variant="outline" className="h-12 w-full" type="button">
                <Bell className="size-4" />
                Lembrar
              </Button>
              {activeConversation ? (
                <Link
                  href={`/demo/mobile/chat?section=${activeConversation.id}`}
                  className={buttonVariants({ variant: "ghost", className: "h-12 w-full" })}
                >
                  Abrir conversa
                </Link>
              ) : (
                <Button variant="ghost" className="h-12 w-full" type="button" disabled>
                  Conversa indisponível
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {openSheet === "pix-pay" && activeDebt && (
        <PixQrModal
          open
          onClose={() => setOpenSheet(null)}
          recipientName={activeDebt.counterpartyName}
          amountCents={activeDebt.amountCents}
          mode="pay"
          pixKey={PIX_KEYS[activeDebt.counterpartyId]}
          onMarkPaid={async () => {
            throw new Error("Esta prévia não registra pagamentos.");
          }}
        />
      )}
      {openSheet === "pix-collect" && activeDebt && (
        <CollectDialog
          open
          onClose={() => setOpenSheet(null)}
          debtorName={activeDebt.counterpartyName.split(" ")[0]}
          amountCents={activeDebt.amountCents}
        />
      )}
    </PreviewShell>
  );
}
