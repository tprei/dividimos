"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClientOnly } from "@/hooks/use-client-only";
import { buildClaimUrl } from "@/lib/claim-qr";
import { formatBRL } from "@/lib/currency";

import {
  CLAIM_TOKEN_PREVIEW,
  CREATED_BILL,
  GUEST_MARIA,
  ME,
  type ShareFixture,
} from "../fixtures";
import { PreviewShell } from "../preview-shell";
import { GuestAvatar } from "../ui/guest-avatar";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";
import type { ScreenProps } from "../mobile-preview";

const REPLACEMENT_CLAIM_TOKEN =
  "gst1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const GUEST_LINK_REPLACED_KEY = `dividimos-preview:claim-replaced:${GUEST_MARIA.id}`;
const GUEST_LINK_REPLACED_EVENT = `dividimos-preview:claim-replaced-changed:${GUEST_MARIA.id}`;

type ClaimSnapshot = "loading" | "fresh" | "replaced" | "unavailable";

function readClaimSnapshot(): ClaimSnapshot {
  if (typeof window === "undefined") return "loading";
  try {
    return window.localStorage.getItem(GUEST_LINK_REPLACED_KEY) === "1"
      ? "replaced"
      : "fresh";
  } catch {
    return "unavailable";
  }
}

function serverClaimSnapshot(): ClaimSnapshot {
  return "loading";
}

function subscribeClaimSnapshot(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === GUEST_LINK_REPLACED_KEY || event.key === null) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(GUEST_LINK_REPLACED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(GUEST_LINK_REPLACED_EVENT, onStoreChange);
  };
}

const GUEST_SHARE: ShareFixture = (() => {
  const match = CREATED_BILL.shares.find((share) => share.guest);
  if (!match) throw new Error("Fixture missing guest share");
  return match;
})();

function ShareName({ share }: { share: ShareFixture }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold">
        {share.id === ME.id ? "Você" : share.name}
      </span>
      {share.guest && <Badge variant="secondary">Convidado</Badge>}
    </div>
  );
}

function ShareSub({ share }: { share: ShareFixture }) {
  if (share.id === ME.id) {
    return (
      <p className="text-xs text-muted-foreground">
        Pagou <Money cents={CREATED_BILL.totalCents} />
      </p>
    );
  }
  if (share.guest) {
    return (
      <p className="text-xs text-muted-foreground">
        <Money cents={share.cents} />
      </p>
    );
  }
  return null;
}

export function BillCreatedScreen({ sheet }: ScreenProps) {
  const [openSheet, setOpenSheet] = useState<string | null>(sheet);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const canShare = useClientOnly(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  const claimState = useSyncExternalStore(
    subscribeClaimSnapshot,
    readClaimSnapshot,
    serverClaimSnapshot,
  );
  const claimReady = claimState === "fresh" || claimState === "replaced";
  const claimToken =
    claimState === "replaced" ? REPLACEMENT_CLAIM_TOKEN : CLAIM_TOKEN_PREVIEW;

  const handleShare = async () => {
    try {
      await navigator.share({
        title: "Dividimos",
        text: `Participe da conta "${CREATED_BILL.title}" no Dividimos! Sua parte: ${formatBRL(GUEST_SHARE.cents)}`,
        url: buildClaimUrl(claimToken),
      });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      toast.error("Erro ao compartilhar");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildClaimUrl(claimToken));
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const handleReplace = () => {
    try {
      window.localStorage.setItem(GUEST_LINK_REPLACED_KEY, "1");
    } catch {
      toast.error("Não foi possível salvar a substituição do link");
      return;
    }
    window.dispatchEvent(new Event(GUEST_LINK_REPLACED_EVENT));
    setConfirmingReplace(false);
  };

  return (
    <PreviewShell nav={null}>
      <ScreenHeader back title={CREATED_BILL.title} />
      <div className="flex items-center gap-4 border-b px-4 pb-4">
        <div className="grid size-10 place-items-center rounded-full bg-success/15 text-success">
          <Check className="size-5" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Total
          </p>
          <Money cents={CREATED_BILL.totalCents} className="text-4xl font-semibold" />
        </div>
      </div>
      <ul className="divide-y divide-border">
        {CREATED_BILL.shares.map((share) => (
          <li key={share.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            {share.guest ? <GuestAvatar size="md" /> : <UserAvatar name={share.name} size="md" />}
            <div className="min-w-0 flex-1">
              <ShareName share={share} />
              <ShareSub share={share} />
            </div>
            {share.guest ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-full px-4"
                onClick={() => setOpenSheet("invite")}
              >
                Convidar
              </Button>
            ) : (
              <Money cents={share.cents} className="text-sm font-semibold" />
            )}
          </li>
        ))}
      </ul>
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" size="lg" className="h-12 w-full text-base font-bold">
          Pronto
        </Button>
      </footer>
      <Dialog
        open={openSheet === "invite"}
        onOpenChange={(open) => setOpenSheet(open ? "invite" : null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle className="text-lg font-bold">Convidar {GUEST_MARIA.name}</DialogTitle>
          <DialogDescription>
            Parte de {formatBRL(GUEST_SHARE.cents)} em {CREATED_BILL.title}
          </DialogDescription>
          <div className="grid gap-2">
            {claimState === "unavailable" && (
              <p role="alert" className="text-xs text-destructive">
                Não foi possível ler o estado do link salvo.
              </p>
            )}
            {canShare && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                disabled={!claimReady}
                onClick={handleShare}
              >
                <ExternalLink className="size-4" />
                Compartilhar
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={!claimReady}
              onClick={handleCopy}
            >
              <Copy className="size-4" />
              Copiar link
            </Button>
            {claimReady && claimState === "fresh" && !confirmingReplace && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setConfirmingReplace(true)}
              >
                <RefreshCw className="size-4" />
                Substituir link
              </Button>
            )}
            {claimReady && claimState === "fresh" && confirmingReplace && (
              <div className="grid gap-2 rounded-xl border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Gerar outro link para {GUEST_MARIA.name}? O link atual será
                  trocado.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={handleReplace}
                  >
                    Substituir
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setConfirmingReplace(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PreviewShell>
  );
}
