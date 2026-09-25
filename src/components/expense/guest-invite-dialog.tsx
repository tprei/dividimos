"use client";

import { Copy, MessageCircle, QrCode, RefreshCw, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
} from "@/components/ui/popover";
import { useClientOnly } from "@/hooks/use-client-only";
import { buildClaimUrl } from "@/lib/claim-qr";
import { clearClaimToken, readClaimTokenEntry, writeClaimToken } from "@/lib/claim-token-cache";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { createGuestClaimToken, revokeGuestClaimToken } from "@/lib/sync/mutations-group";
import { cn } from "@/lib/utils";
import { refreshExpense } from "@/lib/sync/refresh";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { qrToCanvas } from "@/lib/qr";
import type { GuestParticipant } from "@/types/ledger";

interface GuestInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Row or control the surface is anchored to (the button that opened it). */
  anchor: HTMLElement | null;
  guest: GuestParticipant;
  shareCents: number;
  expenseTitle: string;
  expenseId: string;
}

export function GuestInviteDialog({
  open,
  onOpenChange,
  anchor,
  guest,
  shareCents,
  expenseTitle,
  expenseId,
}: GuestInviteDialogProps) {
  const canShare = useClientOnly(isShareSupported);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const inFlightRef = useRef(false);


  const issue = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setWorking(true);
    try {
      const next = await createGuestClaimToken(guest.id);
      writeClaimToken(guest.id, next.token, next.expiresAt);
      setToken(next.token);
      setExpiresAt(next.expiresAt);
      setConfirming(false);
      await refreshExpense(expenseId);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      inFlightRef.current = false;
      setWorking(false);
    }
  }, [guest.id, expenseId]);

  const revoke = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setWorking(true);
    try {
      await revokeGuestClaimToken(guest.id);
      clearClaimToken(guest.id);
      setToken(null);
      setExpiresAt(null);
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
      setExpiresAt(null);
      return;
    }
    // Opening only reads the local cache: a popover boundary must never
    // generate or revoke a link on its own. Issuing is an explicit action.
    const cached = readClaimTokenEntry(guest.id);
    if (cached) {
      setToken(cached.token);
      setExpiresAt(cached.expiresAt);
    } else {
      setToken(null);
      setExpiresAt(null);
    }
  }, [open, guest.id, guest.claimedBy]);

  const claimUrl = token ? buildClaimUrl(token) : null;
  const paintQr = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node || !claimUrl) return;
      // The library pins the drawn size with inline styles, which would
      // outrank the class that shrinks the code in a short popover.
      const unpinSize = () => {
        node.style.removeProperty("width");
        node.style.removeProperty("height");
      };
      void qrToCanvas(node, claimUrl, {
        width: 200,
        margin: 1,
        color: { dark: "#1a1d2e", light: "#ffffff" },
      }).then(unpinSize, unpinSize);
    },
    [claimUrl],
  );
  const canReplace = guest.claimedBy === null;

  const shareText = `Participe da conta "${expenseTitle}" no Dividimos! Sua parte: ${formatBRL(shareCents)}`;
  const whatsappUrl = claimUrl
    ? `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${claimUrl}`)}`
    : null;

  async function handleShare() {
    if (!claimUrl) return;
    const outcome = await shareLink({ title: "Dividimos", text: shareText, url: claimUrl });
    if (outcome === "unsupported") toast.error("Não foi possível compartilhar");
  }

  async function handleCopy() {
    if (!claimUrl) return;
    if (await copyText(claimUrl)) toast.success("Link copiado");
    else toast.error("Não foi possível copiar o link");
  }

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverContent anchor={anchor} side="top" align="center">
          <div className="min-w-0">
            <PopoverTitle className="truncate">Convidar {guest.displayName}</PopoverTitle>
            <PopoverDescription className="truncate">
              Parte de {formatBRL(shareCents)} em {expenseTitle}
            </PopoverDescription>
          </div>
          {claimUrl ? (
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                {canShare && (
                  <Button
                    type="button"
                    className="h-10 w-full"
                    onClick={() => void handleShare()}
                  >
                    <Share2 className="size-4" />
                    Compartilhar
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className={cn("h-10 w-full", !canShare && "col-span-2")}
                  render={<a href={whatsappUrl ?? undefined} target="_blank" rel="noopener noreferrer" aria-label="Enviar pelo WhatsApp" />}
                >
                  <MessageCircle className="size-4" />
                  WhatsApp
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                onClick={() => void handleCopy()}
              >
                <Copy className="size-4" />
                Copiar link
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                aria-expanded={qrOpen}
                aria-controls="guest-claim-qr"
                onClick={() => setQrOpen((shown) => !shown)}
              >
                <QrCode className="size-4" aria-hidden="true" />
                {qrOpen ? "Ocultar QR code" : "Mostrar QR code"}
              </Button>
              {qrOpen && (
                <div id="guest-claim-qr" className="grid justify-items-center gap-1">
                  <div className="rounded-xl bg-white p-2">
                    <canvas ref={paintQr} className="size-[160px]" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Escaneie pelo app para entrar na conta
                  </p>
                </div>
              )}
              {expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Expira em {new Date(expiresAt).toLocaleDateString("pt-BR")}
                </p>
              )}
              {/* The credential-bearing URL is shared, copied, or rendered
                  as a QR code that the app's own scanner reads; it is still
                  never printed as readable text. */}
              {canReplace && !confirming && (
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
              {canReplace && confirming && (
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
              {canReplace && !confirming && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  disabled={working}
                  onClick={() => void revoke()}
                >
                  <Trash2 className="size-4" />
                  Revogar link
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                disabled={working}
                onClick={() => void issue()}
              >
                <RefreshCw className="size-4" />
                {working ? "Gerando link..." : "Gerar link"}
              </Button>
              {guest.claimLinkGeneration > 0 && (
                <p role="status" className="text-xs text-muted-foreground">
                  O link atual só está salvo no aparelho onde foi gerado. Gere outro para
                  compartilhar daqui.
                </p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
