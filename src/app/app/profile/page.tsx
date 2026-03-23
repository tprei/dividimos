"use client";

import { motion } from "framer-motion";
import {
  ChevronRight,
  CreditCard,
  LogOut,
  Moon,
  Phone,
  Shield,
  Smartphone,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export default function ProfilePage() {
  const [darkMode, setDarkMode] = useState(false);

  const toggleDark = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-4"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
          PR
        </div>
        <div>
          <h1 className="text-xl font-bold">Pedro Reis</h1>
          <p className="text-sm text-muted-foreground">+55 11 98765-4321</p>
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
              <p className="text-sm font-medium">Telefone</p>
              <p className="text-xs text-muted-foreground font-mono">(**) *****-4321</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            Usamos sua chave Pix apenas para gerar QR codes de cobranca.
            Seus dados sao armazenados com criptografia de ponta a ponta.
          </p>
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
              <Phone className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Alterar telefone</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <Separator />
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
        <Button variant="outline" className="w-full gap-2 text-destructive">
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </motion.div>
    </div>
  );
}
