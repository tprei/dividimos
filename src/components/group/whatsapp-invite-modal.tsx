"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, MessageCircle, Send, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  buildWhatsAppLink,
  isContactPickerSupported,
  pickContacts,
} from "@/lib/contacts";

interface WhatsAppInviteModalProps {
  open: boolean;
  onClose: () => void;
  groupName: string;
  joinUrl: string;
}

interface SelectedContact {
  name: string;
  phone: string;
  sent: boolean;
}

export function WhatsAppInviteModal({
  open,
  onClose,
  groupName,
  joinUrl,
}: WhatsAppInviteModalProps) {
  const [contacts, setContacts] = useState<SelectedContact[]>([]);
  const [hasContactPicker, setHasContactPicker] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setHasContactPicker(isContactPickerSupported());
  }, []);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setContacts([]);
    }
  }, [open]);

  const inviteMessage = `Oi! Entra no grupo "${groupName}" no Dividimos pra gente dividir as contas 👇\n${joinUrl}`;

  const handlePickContacts = useCallback(async () => {
    setPicking(true);
    const picked = await pickContacts();
    setPicking(false);

    if (!picked || picked.length === 0) return;

    setContacts((prev) => {
      const existingPhones = new Set(prev.map((c) => c.phone));
      const newContacts = picked
        .filter((c) => !existingPhones.has(c.phone))
        .map((c) => ({ ...c, sent: false }));
      return [...prev, ...newContacts];
    });
  }, []);

  const handleSendToContact = useCallback(
    (phone: string) => {
      const url = buildWhatsAppLink(inviteMessage, phone);
      window.open(url, "_blank");
      setContacts((prev) =>
        prev.map((c) => (c.phone === phone ? { ...c, sent: true } : c)),
      );
    },
    [inviteMessage],
  );

  const handleSendGeneric = useCallback(() => {
    const url = buildWhatsAppLink(inviteMessage);
    window.open(url, "_blank");
  }, [inviteMessage]);

  const handleRemoveContact = useCallback((phone: string) => {
    setContacts((prev) => prev.filter((c) => c.phone !== phone));
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
          className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-24 sm:pb-6 sm:rounded-3xl"
        >
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-muted/80 sm:hidden" />

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Convidar via WhatsApp</h3>
              <p className="text-sm text-muted-foreground">{groupName}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Contact list */}
          {contacts.length > 0 && (
            <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
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
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Check className="h-3.5 w-3.5" />
                      Enviado
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveContact(contact.phone)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-[#25D366] hover:bg-[#1da851] text-white"
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

          <div className="space-y-2">
            {/* Pick from contacts button — only on supported platforms */}
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

            {/* Send all — when there are unsent contacts */}
            {contacts.filter((c) => !c.sent).length > 1 && (
              <Button
                className="w-full gap-2 bg-[#25D366] hover:bg-[#1da851] text-white"
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
                Enviar para todos ({contacts.filter((c) => !c.sent).length})
              </Button>
            )}

            {/* Generic WhatsApp share — always available */}
            <Button
              className="w-full gap-2 bg-[#25D366] hover:bg-[#1da851] text-white"
              onClick={handleSendGeneric}
            >
              <MessageCircle className="h-4 w-4" />
              {hasContactPicker
                ? "Enviar sem escolher contato"
                : "Enviar convite pelo WhatsApp"}
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
