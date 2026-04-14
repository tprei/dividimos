"use client";

import { useState } from "react";
import { Bell, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/use-push-notifications";

const SESSION_KEY = "dividimos:notification-prompt-dismissed";

/**
 * Contextual notification opt-in banner shown once per session on group pages.
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
  } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  });

  // Hold the prompt back until the hook finishes its initial permission +
  // subscription check. Otherwise it flashes visible for the already-subscribed
  // case and then disappears, which reads as "the toggle looked off and then
  // snapped on by itself".
  if (isInitializing) return null;

  // Don't show if already subscribed, denied, unsupported, or dismissed
  if (isSubscribed || permission === "denied" || permission === "unsupported" || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY, "1");
    setDismissed(true);
  };

  const handleSubscribe = async () => {
    await subscribe();
    handleDismiss();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3 rounded-2xl border bg-card p-3"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Ativar notificações</p>
          <p className="text-xs text-muted-foreground">
            {isNative
              ? "Receba alertas de contas novas e pagamentos"
              : "Fica sabendo quando rolar conta nova ou pagamento"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            onClick={handleSubscribe}
            disabled={isLoading}
          >
            {isLoading ? "..." : "Ativar"}
          </Button>
          {!isNative && (
            <button
              onClick={handleDismiss}
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
