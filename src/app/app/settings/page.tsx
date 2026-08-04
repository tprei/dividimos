"use client";

import { motion } from "framer-motion";
import {
  Bell,
  BellOff,
  Banknote,
  MessageSquare,
  Receipt,
  Users,
  BellRing,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { updateNotificationPreferences } from "./actions";
import type { NotificationCategory, NotificationPreferences, User } from "@/types";
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
  const { permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();
  const auth = useAuth();

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
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isSubscribed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {isSubscribed ? (
                  <Bell className="h-5 w-5" />
                ) : (
                  <BellOff className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isSubscribed ? "Notificações ativadas" : "Notificações desativadas"}
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

          {isSubscribed && auth.status === "authenticated" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ delay: 0.15, duration: 0.3 }}
              className="mt-4"
            >
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categorias
              </h2>
              <NotificationPreferencesSection
                key={`${auth.generation}:${auth.userId}`}
                user={auth.user}
                userId={auth.userId}
              />
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function NotificationPreferencesSection({
  user,
  userId,
}: {
  user: User;
  userId: string;
}) {
  // Seeded once, from the user this section was mounted with. The parent keys
  // us by generation:userId, so every identity boundary discards this state
  // and a previous account's draft toggles never carry into the new one.
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    () => user.notificationPreferences ?? {},
  );
  const saveTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const persistPrefs = useCallback(
    (next: NotificationPreferences) => {
      clearTimeout(saveTimerRef.current);
      // Capture the caller's identity at schedule time. The keying above is the
      // primary defense; this captured id is the second line so a timer that
      // releases late still names the user who started the edit, and the
      // server compares it against fresh auth before doing anything.
      const expectedUserId = userId;
      saveTimerRef.current = setTimeout(() => {
        updateNotificationPreferences(expectedUserId, next).catch(() => {});
      }, 500);
    },
    [userId],
  );

  const toggleCategory = useCallback(
    (category: NotificationCategory) => {
      setPrefs((prev) => {
        const current = prev[category] !== false;
        const next = { ...prev, [category]: !current };
        persistPrefs(next);
        return next;
      });
    },
    [persistPrefs],
  );

  // Cancel any pending debounced save when the section unmounts. The parent's
  // key makes an identity change an unmount, so a timer captured under the old
  // account can never fire against the new one.
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    };
  }, []);

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
