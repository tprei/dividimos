"use client";

import { motion } from "framer-motion";
import {
  ChevronRight,
  CreditCard,
  LogOut,
  Moon,
  Shield,
  Smartphone,
  AtSign,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const pixKeyTypeLabels: Record<string, string> = {
  phone: "Telefone",
  cpf: "CPF",
  email: "E-mail",
  random: "Chave aleatoria",
};

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);

  const toggleDark = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("dark");
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CreditCard className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">
                {pixKeyTypeLabels[user?.pixKeyType ?? "email"]}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {user?.pixKeyHint || "Nao configurada"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            Usamos sua chave Pix apenas para gerar QR codes de cobranca.
            Seus dados sao armazenados com criptografia AES-256.
          </p>
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
                Compartilhe para amigos te adicionarem em contas
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
          Preferencias
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
              <span className="font-medium">Notificacoes</span>
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
          Seguranca
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
