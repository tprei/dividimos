"use client";

import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  Bell,
  BellRing,
  ChevronRight,
  LogOut,
  MessageSquare,
  Moon,
  Pencil,
  QrCode,
  Receipt,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import type { NotificationCategory, PixKeyType } from "@/types";

import { ME, PIX_KEYS } from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { ScreenHeader } from "../ui/screen-header";

const PIX_TYPE_ENTRIES: [PixKeyType, string][] = [
  ["email", "E-mail"],
  ["phone", "Telefone"],
  ["cpf", "CPF"],
  ["random", "Chave aleatória"],
];

const PIX_KEY_PLACEHOLDERS: Record<PixKeyType, string> = {
  email: "nome@email.com",
  phone: "+5511999998888",
  cpf: "Somente 11 dígitos",
  random: "00000000-0000-0000-0000-000000000000",
};

const NOTIFICATION_CATEGORIES: {
  key: NotificationCategory;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    key: "expenses",
    label: "Despesas",
    description: "Novas despesas, edições e exclusões",
    icon: Receipt,
  },
  {
    key: "settlements",
    label: "Pagamentos",
    description: "Quando alguém registra um pagamento",
    icon: Banknote,
  },
  {
    key: "nudges",
    label: "Lembretes",
    description: "Quando alguém pede que você pague",
    icon: BellRing,
  },
  {
    key: "groups",
    label: "Grupos",
    description: "Convites e novos membros",
    icon: Users,
  },
  {
    key: "messages",
    label: "Mensagens",
    description: "Mensagens diretas",
    icon: MessageSquare,
  },
];

export function ProfileScreen({ sheet }: ScreenProps) {
  const [openSheet, setOpenSheet] = useState<string | null>(sheet);
  const [savedPix, setSavedPix] = useState<{ type: PixKeyType; key: string }>(
    () => ({ type: "email", key: PIX_KEYS[ME.id] }),
  );
  const [pixType, setPixType] = useState<PixKeyType>(savedPix.type);
  const [pixKeyInput, setPixKeyInput] = useState("");
  const [pixError, setPixError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<NotificationCategory, boolean>>({
    expenses: true,
    settlements: true,
    nudges: true,
    groups: true,
    messages: true,
  });
  const [darkMode, setDarkMode] = useState(false);
  const originalDarkRef = useRef<boolean | null>(null);

  useEffect(
    () => () => {
      if (originalDarkRef.current !== null) {
        document.documentElement.classList.toggle("dark", originalDarkRef.current);
      }
    },
    [],
  );

  const openPixDialog = () => {
    setPixType(savedPix.type);
    setPixKeyInput("");
    setPixError(null);
    setOpenSheet("pix");
  };

  const handleSave = () => {
    if (!validatePixKey(pixKeyInput, pixType)) {
      setPixError("Chave Pix inválida para o tipo selecionado");
      return;
    }
    setSavedPix({ type: pixType, key: pixKeyInput });
    setOpenSheet(null);
  };

  const handleDarkMode = (checked: boolean) => {
    if (originalDarkRef.current === null) {
      originalDarkRef.current = document.documentElement.classList.contains("dark");
    }
    setDarkMode(checked);
    document.documentElement.classList.toggle("dark", checked);
  };

  const savedPixLabel = PIX_TYPE_ENTRIES.find(([id]) => id === savedPix.type)?.[1];

  return (
    <PreviewShell nav="profile">
      <ScreenHeader title="Perfil" />
      <div className="space-y-4 px-4">
        <section className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <UserAvatar name={ME.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold">{ME.name}</p>
            <p className="text-sm text-muted-foreground">@{ME.handle}</p>
            <p className="truncate text-xs text-muted-foreground">
              tiago.rocha@email.com
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Editar perfil">
            <Pencil className="size-4" />
          </Button>
        </section>
        <section className="rounded-2xl border bg-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <QrCode className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Chave Pix</p>
              <p className="font-mono text-xs text-muted-foreground">
                {maskPixKey(savedPix.key)}
              </p>
            </div>
            {savedPixLabel !== undefined && (
              <Badge variant="secondary">{savedPixLabel}</Badge>
            )}
          </div>
          <div className="px-4 pb-3">
            <Button
              variant="outline"
              className="h-10 w-full"
              onClick={openPixDialog}
            >
              Alterar chave
            </Button>
          </div>
        </section>
        <section className="rounded-2xl border bg-card">
          <p className="px-4 pt-3 text-sm font-bold">Preferências</p>
          <div className="mt-1 divide-y divide-border">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Moon className="size-5 text-muted-foreground" />
                <Label htmlFor="dark-mode">Modo escuro</Label>
              </div>
              <Switch
                id="dark-mode"
                checked={darkMode}
                onCheckedChange={handleDarkMode}
              />
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setOpenSheet("settings")}
            >
              <span className="flex items-center gap-3">
                <Bell className="size-5 text-muted-foreground" />
                <span className="text-sm">Notificações</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </div>
        </section>
        <Button variant="destructive" size="lg" className="h-12 w-full">
          <LogOut className="size-5" />
          Sair
        </Button>
      </div>
      <Dialog
        open={openSheet === "pix"}
        onOpenChange={(open) => setOpenSheet(open ? "pix" : null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle className="text-lg font-bold">Alterar chave Pix</DialogTitle>
          <DialogDescription className="sr-only">
            Informe o tipo e a nova chave Pix.
          </DialogDescription>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pix-key-type">Tipo de chave</Label>
              <select
                id="pix-key-type"
                value={pixType}
                onChange={(event) => {
                  setPixType(event.target.value as PixKeyType);
                  setPixError(null);
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
              <Label htmlFor="pix-key-input">Nova chave</Label>
              <Input
                id="pix-key-input"
                className="h-11 rounded-xl bg-card"
                placeholder={PIX_KEY_PLACEHOLDERS[pixType]}
                value={pixKeyInput}
                aria-invalid={pixError !== null}
                aria-describedby={pixError !== null ? "pix-key-error" : undefined}
                onChange={(event) => {
                  setPixKeyInput(event.target.value);
                  setPixError(null);
                }}
              />
              {pixError !== null && (
                <p id="pix-key-error" role="alert" className="text-xs text-destructive">
                  {pixError}
                </p>
              )}
            </div>
            <Button
              type="button"
              className="h-12 w-full text-base font-bold"
              onClick={handleSave}
            >
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={openSheet === "settings"}
        onOpenChange={(open) => setOpenSheet(open ? "settings" : null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle className="text-lg font-bold">Notificações</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha quais notificações receber.
          </DialogDescription>
          <div className="divide-y divide-border">
            {NOTIFICATION_CATEGORIES.map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 py-3 first:pt-0">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  checked={prefs[key]}
                  onCheckedChange={(checked) =>
                    setPrefs((current) => ({ ...current, [key]: checked }))
                  }
                  aria-label={label}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PreviewShell>
  );
}
