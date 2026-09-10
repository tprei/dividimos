"use client";

import { Copy, MessageCircle, RefreshCw, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClientOnly } from "@/hooks/use-client-only";
import { buildClaimUrl } from "@/lib/claim-qr";
import { clearClaimToken, readClaimToken, writeClaimToken } from "@/lib/claim-token-cache";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { issueGuestClaimToken } from "@/lib/sync/mutations-group";
import { cn } from "@/lib/utils";
import { refreshExpense } from "@/lib/sync/refresh";
import type { GuestParticipant } from "@/types/ledger";

interface GuestInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guest: GuestParticipant;
  shareCents: number;
  expenseTitle: string;
  expenseId: string;
}

export function GuestInviteDialog({
  open,
  onOpenChange,
  guest,
  shareCents,
  expenseTitle,
  expenseId,
}: GuestInviteDialogProps) {
  const canShare = useClientOnly(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  const [token, setToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inFlightRef = useRef(false);

  const issue = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setWorking(true);
    try {
      const next = await issueGuestClaimToken(guest.id);
      writeClaimToken(guest.id, next);
      setToken(next);
      setConfirming(false);
      await refreshExpense(expenseId);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      inFlightRef.current = false;
      setWorking(false);
    }
  }, [guest.id, expenseId]);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    if (guest.claimedBy) {
      clearClaimToken(guest.id);
      setToken(null);
      return;
    }
    const cached = readClaimToken(guest.id);
    if (cached) {
      setToken(cached);
      return;
    }
    setToken(null);
    if (guest.claimLinkGeneration === 0) {
      void issue();
    }
  }, [open, guest.id, guest.claimLinkGeneration, guest.claimedBy, issue]);

  const claimUrl = token ? buildClaimUrl(token) : null;
  const canReplace = guest.claimLinkGeneration === 1;

  const shareText = `Participe da conta "${expenseTitle}" no Dividimos! Sua parte: ${formatBRL(shareCents)}`;
  const whatsappUrl = claimUrl
    ? `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${claimUrl}`)}`
    : null;

  async function handleShare() {
    if (!claimUrl) return;
    try {
      await navigator.share({ title: "Dividimos", text: shareText, url: claimUrl });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Não foi possível compartilhar");
    }
  }

  async function handleCopy() {
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(claimUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle className="text-lg font-bold">
          Convidar {guest.displayName}
        </DialogTitle>
        <DialogDescription>
          Parte de {formatBRL(shareCents)} em {expenseTitle}
        </DialogDescription>
        <div className="grid gap-2">
          {claimUrl && (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {claimUrl}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {canShare && (
              <Button
                type="button"
                className="h-11 w-full"
                disabled={!claimUrl}
                onClick={() => void handleShare()}
              >
                <Share2 className="size-4" />
                Compartilhar
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={cn("h-11 w-full", !canShare && "col-span-2")}
              disabled={!whatsappUrl}
              render={<a href={whatsappUrl ?? undefined} target="_blank" rel="noopener noreferrer" aria-label="Enviar pelo WhatsApp" />}
            >
              <MessageCircle className="size-4" />
              WhatsApp
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={!claimUrl}
            onClick={() => void handleCopy()}
          >
            <Copy className="size-4" />
            Copiar link
          </Button>
          {!claimUrl && guest.claimLinkGeneration < 2 && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={working}
              onClick={() => void issue()}
            >
              <RefreshCw className="size-4" />
              {working ? "Gerando link..." : "Gerar link"}
            </Button>
          )}
          {!claimUrl && guest.claimLinkGeneration >= 2 && (
            <p role="status" className="text-xs font-semibold text-muted-foreground">
              Este link só está disponível no aparelho onde foi gerado e já foi substituído uma vez.
            </p>
          )}
          {claimUrl && canReplace && !confirming && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setConfirming(true)}
            >
              <RefreshCw className="size-4" />
              Substituir link
            </Button>
          )}
          {claimUrl && canReplace && confirming && (
            <div className="grid gap-2 rounded-xl border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Invalidar link atual?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={working}
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  disabled={working}
                  onClick={() => void issue()}
                >
                  Substituir
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
