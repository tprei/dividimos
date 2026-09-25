"use client";

import {
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Send,
  Users,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useClientOnly } from "@/hooks/use-client-only";
import {
  buildWhatsAppLink,
  isContactPickerSupported,
  pickContacts,
} from "@/lib/contacts";
import { copyText } from "@/lib/platform/clipboard";
import { isShareSupported, shareLink } from "@/lib/platform/share";
import { QrCanvas } from "@/components/shared/qr-canvas";
import { haptics } from "@/hooks/use-haptics";

const PROFILE_QR_OPTIONS = { width: 200, margin: 2 };

interface ConversationShareModalProps {
  open: boolean;
  onClose: () => void;
  handle: string;
}

interface SelectedContact {
  name: string;
  phone: string;
  sent: boolean;
}

export function ConversationShareModal({
  open,
  onClose,
  handle,
}: ConversationShareModalProps) {
  const canShare = useClientOnly(isShareSupported);
  const hasContactPicker = useClientOnly(isContactPickerSupported);
  const [contacts, setContacts] = useState<SelectedContact[]>([]);
  const [picking, setPicking] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setContacts([]);
  }

  const appUrl =
    typeof window !== "undefined" ? `${window.location.origin}/u/${handle}` : "";

  const inviteMessage = `Me adicione no Dividimos! Meu usuário é @${handle}`;

  const handleShare = useCallback(async () => {
    if (!canShare) {
      if (await copyText(`${inviteMessage}\n${appUrl}`)) toast.success("Mensagem copiada!");
      else toast.error("Não deu pra copiar");
      return;
    }
    const outcome = await shareLink({
      title: "Dividimos",
      text: inviteMessage,
      url: appUrl,
    });
    if (outcome === "unsupported") toast.error("Erro ao compartilhar");
  }, [canShare, inviteMessage, appUrl]);

  const handleCopy = useCallback(async () => {
    if (await copyText(`${inviteMessage}\n${appUrl}`)) { haptics.success(); toast.success("Mensagem copiada"); }
    else toast.error("Não deu pra copiar");
  }, [inviteMessage, appUrl]);

  const handleWhatsAppDirect = useCallback(() => {
    const url = buildWhatsAppLink(`${inviteMessage}\n${appUrl}`);
    window.open(url, "_blank");
  }, [inviteMessage, appUrl]);

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
      const url = buildWhatsAppLink(`${inviteMessage}\n${appUrl}`, phone);
      window.open(url, "_blank");
      setContacts((prev) =>
        prev.map((c) => (c.phone === phone ? { ...c, sent: true } : c)),
      );
    },
    [inviteMessage, appUrl],
  );

  const handleRemoveContact = useCallback((phone: string) => {
    setContacts((prev) => prev.filter((c) => c.phone !== phone));
  }, []);

  // Unsent count must exist even while closed; the popover renders nothing
  // on its own when open is false.
  const unsentCount = contacts.filter((c) => !c.sent).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Compartilhar convite</DialogTitle>
        <DialogDescription>@{handle}</DialogDescription>
        <div className="mx-auto rounded-2xl bg-paper p-3">
          <QrCanvas value={appUrl} label={`QR code do perfil de @${handle}`} options={PROFILE_QR_OPTIONS} />
        </div>

        {contacts.length > 0 && (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {contacts.map((contact) => (
              <div
                key={contact.phone}
                className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {contact.name || contact.phone}
                  </p>
                  {contact.name && (
                    <p className="text-xs text-muted-foreground">
                      {contact.phone}
                    </p>
                  )}
                </div>
                {contact.sent ? (
                  <span className="flex items-center gap-1 text-xs text-success-text">
                    <Check className="h-3.5 w-3.5" />
                    Enviado
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-11 p-0 text-muted-foreground hover:text-destructive-text"
                      aria-label={`Remover ${contact.name || contact.phone}`}
                      onClick={() => handleRemoveContact(contact.phone)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="min-h-11 gap-1"
                      onClick={() => handleSendToContact(contact.phone)}
                    >
                      <Send className="h-3 w-3" />
                      Enviar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {unsentCount > 1 && (
          <Button
            className="w-full gap-2"
            onClick={() => {
              const unsent = contacts.filter((c) => !c.sent);
              for (const c of unsent) {
                handleSendToContact(c.phone);
              }
              toast.success(
                `Abrindo WhatsApp para ${unsent.length} contatos`,
              );
            }}
          >
            <Send className="h-4 w-4" />
            Enviar para todos ({unsentCount})
          </Button>
        )}

        <div className="grid gap-2">
          {hasContactPicker && (
            <Button
              className="h-10 w-full gap-2"
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
            className="min-h-11 w-full gap-2"
            onClick={handleWhatsAppDirect}
          >
            <MessageCircle className="h-4 w-4" />
            Enviar pelo WhatsApp
          </Button>

          {canShare && (
            <Button
              className="h-10 w-full gap-2"
              variant="outline"
              onClick={handleShare}
            >
              <ExternalLink className="h-4 w-4" />
              Compartilhar
            </Button>
          )}

          <Button
            variant="outline"
            className="h-10 w-full gap-2"
            onClick={handleCopy}
          >
            <Copy className="h-4 w-4" />
            Copiar mensagem
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Seus contatos não são enviados para nossos servidores
        </p>
      </DialogContent>
    </Dialog>
  );
}
