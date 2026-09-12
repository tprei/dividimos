"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronRight,
  FileText,
  LogOut,
  Moon,
  Pencil,
  QrCode,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { PixKeyDialog } from "@/components/profile/pix-key-dialog";
import { ProfileShareModal } from "@/components/profile/profile-share-modal";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import { updateProfile } from "@/lib/sync/mutations-group";
import { getSupabase } from "@/lib/sync/client";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import type { UpdatePixKeySuccess } from "./actions";
import type { Me } from "@/types/ledger";

const pixKeyTypeLabels: Record<string, string> = {
  cpf: "CPF",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};

export default function ProfilePage() {
  const me = useMe();
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof document === "undefined") return false;
    const stored = localStorage.getItem("theme");
    if (stored) {
      const isDark = stored === "dark";
      document.documentElement.classList.toggle("dark", isDark);
      return isDark;
    }
    return document.documentElement.classList.contains("dark");
  });

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  if (!me) {
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
    <AuthenticatedProfilePage
      key={me.id}
      me={me}
      darkMode={darkMode}
      onToggleDark={toggleDark}
    />
  );
}

function AuthenticatedProfilePage({
  me,
  darkMode,
  onToggleDark,
}: {
  me: Me;
  darkMode: boolean;
  onToggleDark: () => void;
}) {
  const router = useRouter();
  const userId = me.id;

  const [editingProfile, setEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [pixOpen, setPixOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const aliveRef = useRef(true);
  const identityRef = useRef({ userId });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    identityRef.current = { userId };
  });

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    useAppStore.getState().reset();
    router.replace("/auth");
  };

  const startEditProfile = () => {
    setNameInput(me.name);
    setHandleInput(me.handle);
    setProfileError("");
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    const cleanName = nameInput.trim();
    const cleanHandle = handleInput.trim().replace(/^@/, "");
    if (!cleanName || !cleanHandle) return;

    const ownerId = userId;
    setIsSavingProfile(true);
    setProfileError("");

    try {
      await updateProfile({ name: cleanName, handle: cleanHandle });
      if (!aliveRef.current || identityRef.current.userId !== ownerId) return;
      toast.success("Perfil atualizado");
      setEditingProfile(false);
    } catch (err) {
      if (!aliveRef.current || identityRef.current.userId !== ownerId) return;
      setProfileError(ledgerErrorMessage(err));
    } finally {
      if (aliveRef.current) {
        setIsSavingProfile(false);
      }
    }
  };

  const handlePixSaved = (result: UpdatePixKeySuccess) => {
    const current = useAppStore.getState();
    if (current.me?.id !== userId) return;
    current.patch((s) => ({
      me: s.me
        ? {
            ...s.me,
            pixKeyType: result.pixKeyType,
            pixKeyHint: result.pixKeyHint,
          }
        : null,
    }));
    toast.success("Chave Pix atualizada");
  };

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="Perfil" />
      <div className="px-4 pb-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-4"
      >
        <UserAvatar
          name={me.name}
          avatarUrl={me.avatarUrl}
          size="lg"
          priority
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{me.name}</h1>
            {!editingProfile && (
              <button
                onClick={startEditProfile}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label="Editar perfil"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">@{me.handle}</p>
          {me.email && (
            <p className="text-xs text-muted-foreground truncate">{me.email}</p>
          )}
        </div>
        <button
          onClick={() => setShareOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors hover:bg-primary/20"
          aria-label="Compartilhar perfil"
        >
          <QrCode className="h-5 w-5" />
        </button>
      </motion.div>

      <AnimatePresence>
        {editingProfile && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden rounded-2xl border bg-card p-4 space-y-3"
          >
            <div className="space-y-1">
              <Label htmlFor="profile-name" className="text-xs font-medium">
                Nome
              </Label>
              <Input
                id="profile-name"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  setProfileError("");
                }}
                placeholder="Seu nome"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="profile-handle" className="text-xs font-medium">
                Handle (@)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  @
                </span>
                <Input
                  id="profile-handle"
                  className="pl-7"
                  value={handleInput}
                  onChange={(e) => {
                    setHandleInput(e.target.value.replace(/^@/, ""));
                    setProfileError("");
                  }}
                  placeholder="seu_usuario"
                />
              </div>
            </div>

            {profileError && (
              <p className="text-xs text-destructive">{profileError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingProfile(false);
                  setProfileError("");
                }}
                disabled={isSavingProfile}
                className="gap-1"
              >
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSaveProfile}
                disabled={
                  isSavingProfile ||
                  !nameInput.trim() ||
                  !handleInput.trim()
                }
                className="gap-1"
              >
                {isSavingProfile ? (
                  "Salvando..."
                ) : (
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

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-8"
      >
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chave Pix
        </h2>
        <div className="rounded-2xl border bg-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <QrCode className="size-5" />
            </div>
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {me.pixKeyHint || "Nenhuma chave cadastrada"}
            </p>
            {me.pixKeyType && (
              <Badge variant="secondary">{pixKeyTypeLabels[me.pixKeyType]}</Badge>
            )}
          </div>
          <div className="px-4 pb-3">
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => setPixOpen(true)}
            >
              {me.pixKeyHint ? "Alterar chave" : "Cadastrar chave"}
            </Button>
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
              onCheckedChange={onToggleDark}
            />
          </div>
          <Separator />
          <Link
            href="/app/settings"
            className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Notificações</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
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
          <Link
            href="/terms"
            className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Termos de uso</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            href="/privacy"
            className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Privacidade</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
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

      <ProfileShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        handle={me.handle}
        name={me.name}
        avatarUrl={me.avatarUrl}
      />
      <PixKeyDialog
        open={pixOpen}
        onOpenChange={setPixOpen}
        me={me}
        onSaved={handlePixSaved}
      />
    </div>
  );
}
