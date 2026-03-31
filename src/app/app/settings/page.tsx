"use client";

import { motion } from "framer-motion";
import { Bell, BellOff } from "lucide-react";
import { useUser } from "@/contexts/user-context";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const user = useUser();

  const { permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  if (!user) return null;

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
        </motion.div>
      )}
    </div>
  );
}
