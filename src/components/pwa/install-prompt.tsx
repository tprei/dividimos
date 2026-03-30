"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function InstallPrompt({ className }: { className?: string } = {}) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isMobileBrowser()) return;

    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
    if (isIos && isSafari) {
      setIsIosSafari(true);
      return;
    }

    setVisible(true);

    const captured = (window as unknown as Record<string, unknown>).__pwaInstallPrompt as BeforeInstallPromptEvent | null;
    if (captured) {
      deferredPrompt.current = captured;
      (window as unknown as Record<string, unknown>).__pwaInstallPrompt = null;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
    };

    const onAppInstalled = () => {
      deferredPrompt.current = null;
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstall() {
    const prompt = deferredPrompt.current;
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        deferredPrompt.current = null;
        setVisible(false);
        return;
      }
    }

    setDismissed(true);
  }

  if (dismissed || !visible) return null;

  if (isIosSafari) {
    return (
      <div className={className}>
        <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-sm text-muted-foreground">
          <Smartphone className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Pra instalar, toca em{" "}
            <span className="font-medium text-foreground">Compartilhar</span> →{" "}
            <span className="font-medium text-foreground">
              Tela de Início
            </span>
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        size="lg"
        variant="outline"
        className="w-full gap-2 text-base sm:w-auto"
        onClick={handleInstall}
      >
        <Smartphone className="h-5 w-5" />
        Instalar no celular
      </Button>
    </div>
  );
}
