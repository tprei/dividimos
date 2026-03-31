"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign,
  Check,
  ChevronRight,
  Clipboard,
  CreditCard,
  LogOut,
  Moon,
  Pencil,
  Shield,
  Smartphone,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { updatePixKey } from "./actions";
import toast from "react-hot-toast";
import type { PixKeyType } from "@/types";

const pixKeyTypeLabels: Record<string, string> = {
  cpf: "CPF",
  email: "E-mail",
  random: "Chave aleatória",
};

const PIX_KEY_OPTIONS: { type: PixKeyType; label: string }[] = [
  { type: "email", label: "E-mail" },
  { type: "cpf", label: "CPF" },
  { type: "random", label: "Chave aleatória" },
];

function formatCPF(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function toPixKeyValue(type: PixKeyType, display: string): string {
  if (type === "cpf") return display.replace(/\D/g, "");
  return display;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const [darkMode, setDarkMode] = useState(false);
  const [editingPix, setEditingPix] = useState(false);
  const [pixType, setPixType] = useState<PixKeyType>("email");
  const [pixInput, setPixInput] = useState("");
  const [pixError, setPixError] = useState("");
  const [isPending, startTransition] = useTransition();

  const toggleDark = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("dark");
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  const startEditPix = () => {
    setPixType(user?.pixKeyType ?? "email");
    setPixInput("");
    setPixError("");
    setEditingPix(true);
  };

  const handlePixInput = (value: string) => {
    if (pixType === "cpf") {
      setPixInput(formatCPF(value.replace(/\D/g, "").slice(0, 11)));
    } else if (pixType === "random") {
      setPixInput(value.replace(/[^0-9a-fA-F-]/g, "").slice(0, 36).toLowerCase());
    } else {
      setPixInput(value);
    }
    setPixError("");
  };

  const handlePaste = async () => {
    const text = await navigator.clipboard.readText();
    handlePixInput(text.trim());
  };

  const handleSavePix = () => {
    const realValue = toPixKeyValue(pixType, pixInput);
    const formData = new FormData();
    formData.set("pixKey", realValue);
    formData.set("pixKeyType", pixType);

    startTransition(async () => {
      const result = await updatePixKey(formData);
      if (result.error) {
        setPixError(result.error);
        return;
      }
      toast.success("Chave Pix salva");
      setEditingPix(false);
      window.location.reload();
    });
  };

  const getPlaceholder = () => {
    switch (pixType) {
      case "cpf": return "000.000.000-00";
      case "random": return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
      default: return "seu@email.com";
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-4"
      >
        <UserAvatar
          name={user?.name ?? ""}
          avatarUrl={user?.avatarUrl}
          size="lg"
        />
        <div>
          <h1 className="text-xl font-bold">{user?.name}</h1>
          <p className="text-sm text-muted-foreground">@{user?.handle}</p>
          {user?.email && (
            <p className="text-xs text-muted-foreground">{user.email}</p>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chave Pix
        </h2>
        <div className="rounded-2xl border bg-card p-4">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={!editingPix ? startEditPix : undefined}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CreditCard className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">
                {pixKeyTypeLabels[user?.pixKeyType ?? "email"]}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {user?.pixKeyHint || "Não cadastrada"}
              </p>
            </div>
            {!editingPix && (
              <Pencil className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <AnimatePresence>
            {editingPix && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <Separator className="mb-4" />

                <div className="flex flex-wrap gap-2">
                  {PIX_KEY_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => { setPixType(opt.type); setPixInput(""); setPixError(""); }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        pixType === opt.type
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <Input
                    type={pixType === "email" ? "email" : "text"}
                    placeholder={getPlaceholder()}
                    value={pixInput}
                    onChange={(e) => handlePixInput(e.target.value)}
                    inputMode={pixType === "cpf" ? "numeric" : "text"}
                    autoFocus
                  />
                  <Button
                    variant="outline"
                    size="default"
                    onClick={handlePaste}
                    className="shrink-0 gap-1 text-xs"
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                    Colar
                  </Button>
                </div>

                {pixError && (
                  <p className="mt-2 text-xs text-destructive">{pixError}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingPix(false)}
                    className="gap-1"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSavePix}
                    disabled={!pixInput || isPending}
                    className="gap-1"
                  >
                    {isPending ? "Salvando..." : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Salvar
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!editingPix && (
            <>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">
                Sua chave Pix fica guardada a sete chaves. Só usamos pra gerar o QR code na hora de cobrar.
              </p>
            </>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Handle
        </h2>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <AtSign className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">@{user?.handle}</p>
              <p className="text-xs text-muted-foreground">
                Manda pra galera te achar aqui
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Preferências
        </h2>
        <div className="space-y-1 rounded-2xl border bg-card">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Moon className="h-5 w-5 text-muted-foreground" />
              <Label htmlFor="dark-mode" className="cursor-pointer font-medium">
                Modo escuro
              </Label>
            </div>
            <Switch
              id="dark-mode"
              checked={darkMode}
              onCheckedChange={toggleDark}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Notificações</span>
            </div>
            <Switch defaultChecked />
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Segurança
        </h2>
        <div className="space-y-1 rounded-2xl border bg-card">
          <button className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Privacidade</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="mt-8"
      >
        <Button
          variant="outline"
          className="w-full gap-2 text-destructive"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </motion.div>
    </div>
  );
}
