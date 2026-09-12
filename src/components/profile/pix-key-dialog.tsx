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
import { PIX_KEY_ERRORS, validatePixKey } from "@/lib/pix";
import type { PixKeyType } from "@/types";
import type { Me } from "@/types/ledger";

const PIX_TYPE_OPTIONS: { value: PixKeyType; label: string }[] = [
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "cpf", label: "CPF" },
  { value: "random", label: "Chave aleatória" },
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

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  // A pasted +55 11 99999-8888 arrives with the country code already on it.
  const local = digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  return local.slice(0, 11);
}

function constrainInput(type: PixKeyType, value: string): string {
  if (type === "phone") return formatPhoneInput(phoneDigits(value));
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
    const key = toPixKeyValue(pixType, pixInput);
    if (!validatePixKey(key, pixType)) {
      setPixError(PIX_KEY_ERRORS[pixType]);
      return;
    }
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("pixKey", key);
      formData.set("pixKeyType", pixType);
      const result = await updatePixKey(me.id, formData);
      if ("error" in result) {
        setPixError(result.error);
        return;
      }
      onSaved(result);
      onOpenChange(false);
    } catch {
      setPixError("Erro ao salvar. Tente novamente.");
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
            <span id="pix-type-label" className="text-sm font-medium">
              Tipo
            </span>
            <div
              role="radiogroup"
              aria-labelledby="pix-type-label"
              className="flex flex-wrap gap-1.5"
            >
              {PIX_TYPE_OPTIONS.map((option) => {
                const selected = option.value === pixType;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setPixType(option.value);
                      setPixInput("");
                      setPixError("");
                    }}
                    className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition-colors ${
                      selected
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border bg-card text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
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
