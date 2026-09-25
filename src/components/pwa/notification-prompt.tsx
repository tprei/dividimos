"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { popIn } from "@/lib/animations";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { pushFailureMessage } from "@/lib/push/failures";

const SESSION_KEY = "dividimos:notification-prompt-dismissed";

/**
 * Contextual notification opt-in banner on Home and group pages.
 *
 * On web: renders when push is supported, permission hasn't been decided, and
 * the user hasn't dismissed this session.
 *
 * On native (Capacitor): renders when permission is still promptable ("default").
 * Uses Capacitor's runtime permission API instead of the Web Push flow.
 */
export function NotificationPrompt() {
  const {
    permission,
    isSubscribed,
    isLoading,
    isInitializing,
    isNative,
    subscribe,
    error,
    retry,
  } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  });
  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!isSubscribed || typeof window === "undefined") return;
    sessionStorage.setItem(SESSION_KEY, "1");
  }, [isSubscribed]);

  // Hold the prompt back until the hook finishes its initial permission +
  // subscription check. Otherwise it flashes visible for the already-subscribed
  // case and then disappears, which reads as "the toggle looked off and then
  // snapped on by itself".
  if (isInitializing) return null;

  // Don't show if already subscribed, denied, unsupported, or dismissed
  if (
    isSubscribed ||
    permission === "denied" ||
    permission === "unsupported" ||
    dismissed
  ) {
    return null;
  }

  const handleSubscribe = async () => {
    await subscribe();
  };

  return (
    <AnimatePresence>
      <motion.div
        variants={popIn}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative space-y-3 rounded-2xl border border-border bg-card p-4 pr-14"
      >
        <div className="flex items-start gap-3">
          <Bell
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Ativar notificações</p>
            {error === null ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Alertas de contas novas e pagamentos.
              </p>
            ) : (
              <p role="alert" className="mt-1 text-sm text-destructive-text">
                {pushFailureMessage(error)}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            onClick={
              error !== null && error.retryable
                ? () => void retry()
                : handleSubscribe
            }
            disabled={isLoading}
          >
            {isLoading
              ? "Ativando…"
              : error !== null && error.retryable
              ? "Tentar de novo"
              : "Ativar"}
          </Button>
          {!isNative && (
            <IconButton
              onClick={handleDismiss}
              className="absolute top-2 right-2"
              aria-label="Fechar"
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
