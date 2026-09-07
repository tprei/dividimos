"use client";

import { motion } from "framer-motion";
import {
  Bell,
  BellOff,
  Banknote,
  LogOut,
  MessageSquare,
  Receipt,
  Users,
  BellRing,
} from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useMe } from "@/hooks/use-me";
import { useAppStore } from "@/stores/app-store";
import { updateProfile } from "@/lib/sync/mutations-group";
import { getSupabase } from "@/lib/sync/client";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/shared/skeleton";
import type { NotificationCategory, NotificationPreferences } from "@/types";
import type { LucideIcon } from "lucide-react";

interface CategoryConfig {
  key: NotificationCategory;
  label: string;
  description: string;
  icon: LucideIcon;
}

const CATEGORIES: CategoryConfig[] = [
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

export default function SettingsPage() {
  const me = useMe();
  const router = useRouter();
  const { permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    useAppStore.getState().reset();
    router.replace("/auth");
  };

  if (!me) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-2xl font-bold"
      >
        Configurações
      </motion.h1>

      {permission !== "unsupported" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mt-8"
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notificações
          </h2>

          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  isSubscribed
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isSubscribed ? (
                  <Bell className="h-5 w-5" />
                ) : (
                  <BellOff className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isSubscribed
                    ? "Notificações ativadas"
                    : "Notificações desativadas"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {permission === "denied"
                    ? "Bloqueado pelo navegador — altere nas configurações do site"
                    : isSubscribed
                      ? "Você receberá alertas de contas e pagamentos"
                      : "Receba alertas quando adicionarem contas ou confirmarem pagamentos"}
                </p>
              </div>
            </div>

            <div className="mt-4">
              {permission === "denied" ? (
                <p className="text-xs text-muted-foreground">
                  Para reativar, abra as configurações do navegador e permita notificações para este site.
                </p>
              ) : isSubscribed ? (
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={unsubscribe}
                  disabled={pushLoading}
                >
                  {pushLoading ? "Desativando..." : "Desativar notificações"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={subscribe}
                  disabled={pushLoading}
                >
                  {pushLoading ? "Ativando..." : "Ativar notificações"}
                </Button>
              )}
            </div>
          </div>

          {isSubscribed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ delay: 0.15, duration: 0.3 }}
              className="mt-4"
            >
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categorias
              </h2>
              <NotificationPreferencesSection key={me.id} />
            </motion.div>
          )}
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
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

function NotificationPreferencesSection() {
  const me = useMe();
  const prefs = me?.notificationPreferences ?? {};

  const toggleCategory = async (category: NotificationCategory) => {
    const currentMe = useAppStore.getState().me;
    if (!currentMe) return;

    const currentPrefs = currentMe.notificationPreferences ?? {};
    const currentVal = currentPrefs[category] !== false;
    const nextPrefs: NotificationPreferences = {
      ...currentPrefs,
      [category]: !currentVal,
    };

    useAppStore.getState().patch((s) => ({
      me: s.me ? { ...s.me, notificationPreferences: nextPrefs } : null,
    }));

    try {
      await updateProfile({ notificationPreferences: nextPrefs });
    } catch (err) {
      useAppStore.getState().patch((s) => ({
        me: s.me ? { ...s.me, notificationPreferences: currentPrefs } : null,
      }));
      toast.error(ledgerErrorMessage(err));
    }
  };

  return (
    <div className="rounded-2xl border bg-card">
      {CATEGORIES.map((cat, i) => {
        const Icon = cat.icon;
        const enabled = prefs[cat.key] !== false;
        return (
          <div key={cat.key}>
            {i > 0 && <Separator />}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{cat.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {cat.description}
                  </p>
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={() => toggleCategory(cat.key)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
