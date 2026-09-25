"use client";

import { motion } from "framer-motion";
import { popIn } from "@/lib/animations";
import { haptics } from "@/hooks/use-haptics";
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
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { pushFailureMessage } from "@/lib/push/failures";
import { useMe } from "@/hooks/use-me";
import { useSignOut } from "@/hooks/use-sign-out";
import { useConfirmationPreferences } from "@/hooks/use-confirmation-preferences";
import { isScanDraftChoice } from "@/lib/confirmation-preferences";
import { useAppStore } from "@/stores/app-store";
import { updateProfile } from "@/lib/sync/mutations-group";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/select-field";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/shared/skeleton";
import { ScreenHeader } from "@/components/shared/screen-header";
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
    label: "Contas",
    description: "Contas novas, editadas ou excluídas",
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

const SCAN_DRAFT_CHOICE_OPTIONS = [
  { value: "ask", label: "Perguntar" },
  { value: "replace", label: "Substituir o rascunho" },
  { value: "keep", label: "Manter o rascunho" },
];

export default function SettingsPage() {
  const me = useMe();
  const router = useRouter();
  const {
    permission,
    isSubscribed,
    isLoading: pushLoading,
    subscribe,
    unsubscribe,
    error: pushError,
    retry: pushRetry,
  } = usePushNotifications();
  const { pending: signOutPending, error: signOutError, signOut } = useSignOut();
  const [confirmations, updateConfirmations] = useConfirmationPreferences(me?.id ?? "");

  const handleSignOut = async () => {
    if (!signOutError && !window.confirm("Sair da conta?")) return;
    const result = await signOut();
    if (result.ok) router.replace("/auth");
  };

  if (!me) {
    return (
      <div role="status" aria-label="Carregando" className="mx-auto max-w-lg px-4 py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-6 md:max-w-2xl">
      <div className="-mx-4"><ScreenHeader back title="Configurações" /></div>
      {permission !== "unsupported" && (
        <motion.div
          variants={popIn} initial="hidden" animate="visible"
          className="mt-6"
        >
          <h2 className="mb-3 text-lg font-bold">
            Notificações
          </h2>

          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
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
                <p className="text-base font-semibold">
                  Notificações push
                </p>
                <p className="text-sm text-muted-foreground">
                  {permission === "denied"
                    ? "Permita notificações nas configurações do navegador."
                    : pushLoading ? "Atualizando..." : "Alertas de contas e pagamentos"}
                </p>
              </div>
              <Switch aria-label="Notificações push" checked={isSubscribed} disabled={pushLoading || permission === "denied"} onCheckedChange={(enabled) => {
                haptics.selectionChanged();
                if (enabled) void subscribe(); else void unsubscribe();
              }} />
            </div>

            <div className="mt-4">
              {pushError !== null && (
                <p role="alert" className="mt-2 text-sm text-destructive-text">
                  {pushFailureMessage(pushError)}
                  {pushError.retryable && (
                    <Button variant="ghost" onClick={() => void pushRetry()}>Tentar novamente</Button>
                  )}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {permission !== "unsupported" && isSubscribed && (
        <div className="mt-4">
          <h2 className="mb-3 text-lg font-bold">
            Categorias
          </h2>
          <NotificationPreferencesSection key={me.id} />
        </div>
      )}

      <motion.div
        variants={popIn} initial="hidden" animate="visible"
        className="mt-6"
      >
        <h2 className="mb-3 text-lg font-bold">
          Confirmações
        </h2>
        <div className="divide-y rounded-2xl border bg-card">
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
            <div>
              <p className="text-sm font-medium">Confirmar antes de desfazer um pagamento</p>
              <p className="text-xs text-muted-foreground">
                Mostra um aviso antes de marcar um registro como desfeito
              </p>
            </div>
            <Switch
              checked={confirmations.confirmVoidSettlement}
              onCheckedChange={(checked) => { haptics.selectionChanged(); updateConfirmations({ confirmVoidSettlement: checked }); }}
              aria-label="Confirmar antes de desfazer um pagamento"
            />
          </div>
          <div className="space-y-2 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Nota escaneada com rascunho aberto</p>
              <p className="text-xs text-muted-foreground">
                O que fazer quando você escaneia uma nota e já tem uma conta em rascunho
              </p>
            </div>
            <SelectField
              label="Nota escaneada com rascunho aberto"
              hideLabel
              value={confirmations.scanDraftChoice}
              options={SCAN_DRAFT_CHOICE_OPTIONS}
              onChange={(value) => {
                if (isScanDraftChoice(value)) updateConfirmations({ scanDraftChoice: value });
              }}
            />
          </div>
        </div>
      </motion.div>

      <motion.div
        variants={popIn} initial="hidden" animate="visible"
        className="mt-6"
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
          className="w-full gap-2 text-destructive-text"
          onClick={() => void handleSignOut()}
          disabled={signOutPending}
        >
          <LogOut className="h-4 w-4" />
          {signOutPending ? "Saindo..." : "Sair da conta"}
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

  // Each category shows its own state: the switch moves immediately, but the
  // row says so until the write lands, and says so louder if it fails.
  const [saving, setSaving] = useState<Record<NotificationCategory, boolean>>(() =>
    emptyCategoryRecord(false),
  );
  const [failed, setFailed] = useState<Record<NotificationCategory, boolean>>(() =>
    emptyCategoryRecord(false),
  );

  const toggleCategory = (category: NotificationCategory) => {
    haptics.selectionChanged();
    const currentMe = useAppStore.getState().me;
    if (!currentMe) return;

    const currentVal = (currentMe.notificationPreferences ?? {})[category] !== false;
    const intent = !currentVal;

    generationsRef.current[category] += 1;
    const generation = generationsRef.current[category];
    intentsRef.current[category] = intent;
    pendingRef.current[category] += 1;
    setSaving((prev) => ({ ...prev, [category]: true }));
    setFailed((prev) => (prev[category] ? { ...prev, [category]: false } : prev));

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
          setFailed((prev) => ({ ...prev, [category]: true }));
          toast.error(ledgerErrorMessage(err));
        }
      } finally {
        pendingRef.current[category] -= 1;
        // Only the newest write for this category clears the indicator; an
        // older one finishing late says nothing about the current intent.
        if (generationsRef.current[category] === generation) {
          setSaving((prev) => ({ ...prev, [category]: false }));
        }
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
        const isSaving = saving[cat.key];
        const hasFailed = failed[cat.key];
        return (
          <div key={cat.key}>
            {i > 0 && <Separator />}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{cat.label}</p>
                  {hasFailed ? (
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.key)}
                      className="text-xs font-medium text-destructive underline"
                    >
                      Não salvou. Tentar novamente
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {isSaving ? "Salvando..." : cat.description}
                    </p>
                  )}
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={() => toggleCategory(cat.key)}
                aria-label={cat.label}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
