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
import { useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useMe } from "@/hooks/use-me";
import { useSignOut } from "@/hooks/use-sign-out";
import { useAppStore } from "@/stores/app-store";
import { updateProfile } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/shared/skeleton";
import type { NotificationCategory } from "@/types";
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
  const { pending: signOutPending, error: signOutError, signOut } = useSignOut();

  const handleSignOut = async () => {
    const result = await signOut();
    if (result.ok) router.replace("/auth");
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
        </motion.div>
      )}

      {permission !== "unsupported" && isSubscribed && (
        <div className="mt-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Categorias
          </h2>
          <NotificationPreferencesSection key={me.id} />
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-8"
      >
        {signOutError && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-sm text-destructive">
            <span>{signOutError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleSignOut()}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        <Button
          variant="outline"
          className="w-full gap-2 text-destructive"
          onClick={() => void handleSignOut()}
          disabled={signOutPending}
        >
          <LogOut className="h-4 w-4" />
          {signOutPending ? "Saindo..." : "Sair"}
        </Button>
      </motion.div>
    </div>
  );
}

const CATEGORY_KEYS = CATEGORIES.map((cat) => cat.key);

function emptyCategoryRecord<T>(value: T): Record<NotificationCategory, T> {
  return {
    expenses: value,
    settlements: value,
    nudges: value,
    groups: value,
    messages: value,
  };
}

function NotificationPreferencesSection() {
  const me = useMe();
  const prefs = me?.notificationPreferences ?? {};

  const chainsRef = useRef<Record<NotificationCategory, Promise<void>>>(
    emptyCategoryRecord(Promise.resolve()),
  );
  const generationsRef = useRef<Record<NotificationCategory, number>>(
    emptyCategoryRecord(0),
  );
  const intentsRef = useRef<Record<NotificationCategory, boolean>>(
    emptyCategoryRecord(true),
  );
  const pendingRef = useRef<Record<NotificationCategory, number>>(
    emptyCategoryRecord(0),
  );

  const toggleCategory = (category: NotificationCategory) => {
    const currentMe = useAppStore.getState().me;
    if (!currentMe) return;

    const currentVal = (currentMe.notificationPreferences ?? {})[category] !== false;
    const intent = !currentVal;

    generationsRef.current[category] += 1;
    const generation = generationsRef.current[category];
    intentsRef.current[category] = intent;
    pendingRef.current[category] += 1;

    useAppStore.getState().patch((s) => {
      if (!s.me) return {};
      return {
        me: {
          ...s.me,
          notificationPreferences: { ...s.me.notificationPreferences, [category]: intent },
        },
      };
    });

    const previous = chainsRef.current[category];
    const task = previous.then(async () => {
      try {
        if (generationsRef.current[category] !== generation) return;
        await updateProfile({ notificationPreferences: { [category]: intent } });
      } catch (err) {
        if (generationsRef.current[category] === generation) {
          useAppStore.getState().patch((s) => {
            if (!s.me) return {};
            return {
              me: {
                ...s.me,
                notificationPreferences: {
                  ...s.me.notificationPreferences,
                  [category]: !intent,
                },
              },
            };
          });
          toast.error(ledgerErrorMessage(err));
        }
      } finally {
        pendingRef.current[category] -= 1;
        const queued = CATEGORY_KEYS.filter((key) => pendingRef.current[key] > 0);
        if (queued.length > 0) {
          useAppStore.getState().patch((s) => {
            if (!s.me) return {};
            const nextPrefs = { ...s.me.notificationPreferences };
            for (const key of queued) nextPrefs[key] = intentsRef.current[key];
            return { me: { ...s.me, notificationPreferences: nextPrefs } };
          });
        }
      }
    });
    chainsRef.current[category] = task;
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
