"use client";

import { useState } from "react";
import { updatePixKey } from "@/app/app/profile/actions";
import type { UpdatePixKeySuccess } from "@/app/app/profile/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PixKeyType } from "@/types";
import type { Me } from "@/types/ledger";

const PIX_TYPE_ENTRIES: [PixKeyType, string][] = [
  ["email", "E-mail"],
  ["phone", "Telefone"],
  ["cpf", "CPF"],
  ["random", "Chave aleatória"],
];

const PIX_KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
  email: "seu@email.com",
  phone: "(11) 99999-9999",
  cpf: "000.000.000-00",
  random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

function formatPhoneInput(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCPF(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function toPixKeyValue(type: PixKeyType, display: string): string {
  if (type === "phone") return `+55${display.replace(/\D/g, "")}`;
  if (type === "cpf") return display.replace(/\D/g, "");
  return display;
}

function constrainInput(type: PixKeyType, value: string): string {
  if (type === "phone") return formatPhoneInput(value.replace(/\D/g, "").slice(0, 11));
  if (type === "cpf") return formatCPF(value.replace(/\D/g, "").slice(0, 11));
  if (type === "random")
    return value.replace(/[^0-9a-fA-F-]/g, "").slice(0, 36).toLowerCase();
  return value;
}

export interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Me;
  onSaved: (result: UpdatePixKeySuccess) => void;
}

export function PixKeyDialog({ open, onOpenChange, me, onSaved }: PixKeyDialogProps) {
  const [pixType, setPixType] = useState<PixKeyType>(me.pixKeyType ?? "email");
  const [pixInput, setPixInput] = useState("");
  const [pixError, setPixError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPixType(me.pixKeyType ?? "email");
      setPixInput("");
      setPixError("");
    }
  }

  const handleSave = async () => {
    if (!pixInput || isSaving) return;
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("pixKey", toPixKeyValue(pixType, pixInput));
      formData.set("pixKeyType", pixType);
      const result = await updatePixKey(me.id, formData);
      if ("error" in result) {
        setPixError(result.error);
        return;
      }
      onSaved(result);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle className="text-lg font-bold">Chave Pix</DialogTitle>
        <DialogDescription>Usada para receber pagamentos.</DialogDescription>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pix-type">Tipo</Label>
            <select
              id="pix-type"
              value={pixType}
              onChange={(event) => {
                setPixType(event.target.value as PixKeyType);
                setPixInput("");
                setPixError("");
              }}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              {PIX_TYPE_ENTRIES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pix-key">Chave</Label>
            <Input
              id="pix-key"
              className="h-11 rounded-xl bg-card"
              type={pixType === "email" ? "email" : "text"}
              inputMode={pixType === "phone" || pixType === "cpf" ? "numeric" : "text"}
              placeholder={PIX_KEY_PLACEHOLDERS[pixType]}
              value={pixInput}
              aria-invalid={pixError !== ""}
              aria-describedby={pixError !== "" ? "pix-key-error" : undefined}
              onChange={(event) => {
                setPixInput(constrainInput(pixType, event.target.value));
                setPixError("");
              }}
            />
            {pixError && (
              <p id="pix-key-error" role="alert" className="text-xs text-destructive">
                {pixError}
              </p>
            )}
          </div>
          <Button
            type="button"
            className="min-h-11 w-full"
            onClick={handleSave}
            disabled={!pixInput || isSaving}
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
