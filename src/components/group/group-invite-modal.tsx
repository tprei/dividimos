"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Copy,
  ExternalLink,
  Link2Off,
  Loader2,
  MessageCircle,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { InviteContactsList, type InviteContact } from "@/components/group/group-invite-contacts";
import { useClientOnly } from "@/hooks/use-client-only";
import { Button } from "@/components/ui/button";
import { useBackHandler } from "@/hooks/use-back-handler";
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
  const canShare = useClientOnly(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
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
    createInviteLink(groupId, null, null)
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
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#1a1d2e", light: "#ffffff" },
    });
  }, [open, joinUrl]);

  const inviteMessage = `Entre no grupo "${groupName}" no Dividimos!`;

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Dividimos",
          text: inviteMessage,
          url: joinUrl,
        });
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          toast.error("Erro ao compartilhar");
        }
      }
    } else {
      await navigator.clipboard.writeText(`${inviteMessage}\n${joinUrl}`);
      toast.success("Link copiado!");
    }
  }, [inviteMessage, joinUrl]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(joinUrl);
    toast.success("Link copiado!");
  }, [joinUrl]);

  const handleWhatsAppDirect = useCallback(() => {
    const url = buildWhatsAppLink(`${inviteMessage}\n${joinUrl}`);
    window.open(url, "_blank");
  }, [inviteMessage, joinUrl]);

  const handlePickContacts = useCallback(async () => {
    setPicking(true);
    let result;
    try {
      result = await pickContacts();
    } finally {
      // The button must come back even when picking threw, or the only way
      // to invite from contacts is to close and reopen the modal.
      setPicking(false);
    }

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
      toast.success("Link desativado");
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setDeactivating(false);
    }
  }, [groupId]);

  // This overlay is hand-rolled rather than a Dialog, so it has to join the
  // hardware-back stack itself. Without this, Back navigated away from the
  // group behind the modal, or closed the app.
  useBackHandler(open, onClose);

  const handleRegenerate = useCallback(() => {
    requestedRef.current = false;
    setLinkState("idle");
  }, []);

  if (!open) return null;


  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center backdrop-blur-sm bg-black/40 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              onClose();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl overflow-y-auto max-h-[90vh]"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Convite para o grupo</h3>
              <p className="text-sm text-muted-foreground">{groupName}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {linkState === "ready" ? (
            <>
              <div className="flex justify-center rounded-2xl bg-white p-4">
                <canvas ref={canvasRef} />
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Escaneie ou compartilhe o link para entrar no grupo
              </p>
              <div className="mt-2 flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
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

          <div className="mt-4 space-y-2">
            {hasContactPicker && (
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={handlePickContacts}
                disabled={picking}
              >
                <Users className="h-4 w-4" />
                {contacts.length > 0
                  ? "Adicionar mais contatos"
                  : "Escolher dos contatos"}
              </Button>
            )}

            <Button
              className="w-full gap-2 bg-[#25D366] hover:bg-[#1da851] text-white"
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
              className="w-full gap-2"
              onClick={handleCopy}
              disabled={!joinUrl}
            >
              <Copy className="h-4 w-4" />
              Copiar link
            </Button>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Seus contatos não são enviados para nossos servidores
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
