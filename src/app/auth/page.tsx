"use client";

import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

export default function AuthPage() {
  const supabase = createClient();

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="gradient-mesh absolute inset-0 -z-10" />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Logo size="lg" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-4 text-center text-muted-foreground"
        >
          Divida contas com amigos via Pix
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12 w-full"
        >
          <div className="rounded-2xl border bg-card p-8 shadow-sm">
            <h1 className="text-center text-xl font-semibold">Entrar</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Use sua conta Google para continuar
            </p>

            <Button
              onClick={handleGoogleSignIn}
              className="mt-8 flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border bg-white text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:bg-white dark:text-gray-700 dark:hover:bg-gray-50"
              variant="outline"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z"
                />
                <path
                  fill="#34A853"
                  d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.02c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.29H1.84v2.08A8 8 0 0 0 8.98 17Z"
                />
                <path
                  fill="#FBBC05"
                  d="M4.51 10.52A4.78 4.78 0 0 1 4.26 9c0-.53.09-1.04.25-1.52V5.4H1.84A8 8 0 0 0 .98 9c0 1.29.31 2.51.86 3.6l2.67-2.08Z"
                />
                <path
                  fill="#EA4335"
                  d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .98 9l2.87 2.23C4.14 4.99 6.5 3.58 8.98 3.58Z"
                />
              </svg>
              Entrar com Google
            </Button>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              Em conformidade com a LGPD (Lei 13.709/2018). Seus dados sao
              protegidos e nunca compartilhados sem consentimento. Voce pode
              excluir sua conta a qualquer momento.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
