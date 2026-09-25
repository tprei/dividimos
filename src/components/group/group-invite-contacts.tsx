"use client";

import { Check, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/user-avatar";
import { haptics } from "@/hooks/use-haptics";

export interface InviteContact {
  name: string;
  phone: string;
  sent: boolean;
}

interface InviteContactsListProps {
  contacts: InviteContact[];
  onSend: (phone: string) => boolean;
  onRemove: (phone: string) => void;
}

export function InviteContactsList({ contacts, onSend, onRemove }: InviteContactsListProps) {
  if (contacts.length === 0) return null;

  const unsent = contacts.filter((c) => !c.sent);

  return (
    <>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {contacts.map((contact) => (
          <div
            key={contact.phone}
            className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3"
          >
            <UserAvatar id={contact.phone} name={contact.name || contact.phone} size="sm" />
            <div className="flex-1 min-w-0">
              <p title={contact.name || contact.phone} className="truncate text-sm font-semibold">
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
                Aberto
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-11 p-0 text-muted-foreground hover:text-destructive-text"
                  aria-label={`Remover ${contact.name || contact.phone}`}
                  onClick={() => { haptics.tap(); onRemove(contact.phone); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  className="gap-1 bg-[#25D366] text-[#082b15] hover:bg-[#1da851]"
                  onClick={() => { haptics.tap(); onSend(contact.phone); }}
                >
                  <Send className="h-3 w-3" />
                  Enviar
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {unsent.length > 1 && (
        <Button
          className="mt-2 w-full gap-2 bg-[#25D366] text-[#082b15] hover:bg-[#1da851]"
          onClick={() => {
            let opened = 0;
            for (const c of unsent) {
              if (onSend(c.phone)) opened += 1;
            }
            // Blocked contacts already get a toast from onSend.
            if (opened === unsent.length) {
              toast.success(`Abrindo WhatsApp para ${opened} contatos`);
            }
          }}
        >
          <Send className="h-4 w-4" />
          Enviar para todos ({unsent.length})
        </Button>
      )}
    </>
  );
}
