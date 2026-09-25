"use client";

import {
  Copy,
  ExternalLink,
  Link2Off,
  Loader2,
  MessageCircle,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { InviteContactsList, type InviteContact } from "@/components/group/group-invite-contacts";
import { useClientOnly } from "@/hooks/use-client-only";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { haptics } from "@/hooks/use-haptics";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  createInviteLink,
  deactivateInviteLink,
} from "@/lib/sync/mutations-group";
import {
  buildWhatsAppLink,
  isContactPickerSupported,
  pickContacts,
} from "@/lib/contacts";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { qrToCanvas } from "@/lib/qr";

interface GroupInviteModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
}

type LinkState = "idle" | "creating" | "ready" | "revoked";

export function GroupInviteModal({
  open,
  onClose,
  groupId,
  groupName,
}: GroupInviteModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestedRef = useRef(false);
  const canShare = useClientOnly(isShareSupported);
  const hasContactPicker = useClientOnly(isContactPickerSupported);
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  const [picking, setPicking] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setContacts([]);
      setToken(null);
      setLinkState("idle");
      requestedRef.current = false;
    }
  }

  useEffect(() => {
    if (!open || linkState !== "idle" || requestedRef.current) return;
    requestedRef.current = true;
    let active = true;
    // A QR in a group photo or screenshot would otherwise be a permanent
    // backdoor; two hours covers everyone scanning in the moment.
    createInviteLink(groupId, new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), null)
      .then((link) => {
        if (!active) return;
        setToken(link.token);
        setLinkState("ready");
      })
      .catch((e: unknown) => {
        if (!active) return;
        toast.error(ledgerErrorMessage(e));
        setLinkState("revoked");
      })
      .finally(() => {
        active = false;
      });
    return () => {
      active = false;
    };
  }, [open, groupId, linkState]);

  const joinUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/join/${token}`
      : "";

  useEffect(() => {
    if (!open || !joinUrl || !canvasRef.current) return;
    void qrToCanvas(canvasRef.current, joinUrl, {
      width: 160,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    }).catch(() => toast.error("Não deu pra gerar o QR code"));
  }, [open, joinUrl]);

  const inviteMessage = `Entre no grupo "${groupName}" no Dividimos!`;

  const handleShare = useCallback(async () => {
    if (!canShare) {
      if (await copyText(`${inviteMessage}\n${joinUrl}`)) { haptics.success(); toast.success("Link copiado"); }
      else toast.error("Não deu pra copiar");
      return;
    }
    const outcome = await shareLink({
      title: "Dividimos",
      text: inviteMessage,
      url: joinUrl,
    });
    if (outcome === "unsupported") toast.error("Erro ao compartilhar");
  }, [canShare, inviteMessage, joinUrl]);

  const handleCopy = useCallback(async () => {
    if (await copyText(joinUrl)) { haptics.success(); toast.success("Link copiado"); }
    else toast.error("Não deu pra copiar");
  }, [joinUrl]);

  const handleWhatsAppDirect = useCallback(() => {
    const url = buildWhatsAppLink(`${inviteMessage}\n${joinUrl}`);
    haptics.tap();
    window.open(url, "_blank");
  }, [inviteMessage, joinUrl]);

  const handlePickContacts = useCallback(async () => {
    setPicking(true);
    const result = await pickContacts().finally(() => setPicking(false));

    if (result.status === "cancelled") return;
    if (result.status === "unsupported") {
      toast.error("Seu dispositivo não suporta escolher contatos do celular.");
      return;
    }
    if (result.status === "permission_denied") {
      toast.error("Permissão de contatos negada. Verifique as configurações do app.");
      return;
    }
    if (result.status === "error") {
      toast.error("Não foi possível abrir os contatos. Tente novamente.");
      return;
    }
    if (result.contacts.length === 0) {
      toast.error("Nenhum contato com telefone selecionado.");
      return;
    }

    setContacts((prev) => {
      const existingPhones = new Set(prev.map((c) => c.phone));
      const newContacts = result.contacts
        .filter((c) => !existingPhones.has(c.phone))
        .map((c) => ({ ...c, sent: false }));
      return [...prev, ...newContacts];
    });
  }, []);

  const handleSendToContact = useCallback(
    (phone: string) => {
      const url = buildWhatsAppLink(`${inviteMessage}\n${joinUrl}`, phone);
      const composer = window.open(url, "_blank");
      if (!composer) {
        // Popup blocked: nothing opened, keep the contact retryable.
        toast.error("Não foi possível abrir o WhatsApp. Tente novamente.");
        return false;
      }
      setContacts((prev) =>
        prev.map((c) => (c.phone === phone ? { ...c, sent: true } : c)),
      );
      return true;
    },
    [inviteMessage, joinUrl],
  );

  const handleRemoveContact = useCallback((phone: string) => {
    setContacts((prev) => prev.filter((c) => c.phone !== phone));
  }, []);

  const handleDeactivate = useCallback(async () => {
    setDeactivating(true);
    try {
      await deactivateInviteLink(groupId);
      setToken(null);
      setLinkState("revoked");
      haptics.success();
      toast.success("Link desativado");
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setDeactivating(false);
    }
  }, [groupId]);


  const handleRegenerate = useCallback(() => {
    requestedRef.current = false;
    setLinkState("idle");
  }, []);

  if (!open) return null;


  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="gap-3">
        <DialogHeader>
          <DialogTitle>Convidar pro grupo</DialogTitle>
          <DialogDescription className="truncate" title={groupName}>{groupName}</DialogDescription>
        </DialogHeader>

          {linkState === "ready" ? (
            <>
              <div className="mx-auto flex w-fit justify-center rounded-2xl bg-paper p-2">
                <canvas ref={canvasRef} aria-label="QR code do convite" />
              </div>
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive-text"
                  disabled={deactivating}
                  onClick={handleDeactivate}
                >
                  {deactivating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Link2Off className="h-3 w-3" />
                  )}
                  Desativar link
                </Button>
              </div>
            </>
          ) : linkState === "revoked" ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12">
              <p className="text-sm text-muted-foreground">
                Nenhum link de convite ativo.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleRegenerate}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Gerar novo link
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border bg-muted/30 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Gerando link...</p>
            </div>
          )}

          <InviteContactsList
            contacts={contacts}
            onSend={handleSendToContact}
            onRemove={handleRemoveContact}
          />

          <div className="grid grid-cols-2 gap-2">
            {hasContactPicker && (
              <Button
                className="col-span-2 w-full gap-2"
                variant="outline"
                onClick={handlePickContacts}
                disabled={picking || !joinUrl}
              >
                <Users className="h-4 w-4" />
                {contacts.length > 0
                  ? "Adicionar mais contatos"
                  : "Escolher dos contatos"}
              </Button>
            )}

            <Button
              className="col-span-2 w-full gap-2 bg-[#25D366] text-[#082b15] hover:bg-[#1da851]"
              onClick={handleWhatsAppDirect}
              disabled={!joinUrl}
            >
              <MessageCircle className="h-4 w-4" />
              Enviar pelo WhatsApp
            </Button>

            {canShare && (
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={handleShare}
                disabled={!joinUrl}
              >
                <ExternalLink className="h-4 w-4" />
                Compartilhar
              </Button>
            )}

            <Button
              variant="outline"
              className={`w-full gap-2 ${canShare ? "" : "col-span-2"}`}
              onClick={handleCopy}
              disabled={!joinUrl}
            >
              <Copy className="h-4 w-4" />
              Copiar link
            </Button>
          </div>

          {hasContactPicker && <p className="text-center text-xs text-muted-foreground">Seus contatos ficam no seu dispositivo.</p>}
      </DialogContent>
    </Dialog>
  );
}
