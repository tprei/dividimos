"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}

function detectPlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

export function InstallPrompt({ className }: { className?: string } = {}) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    if (!isMobileBrowser()) return;

    setPlatform(detectPlatform());
    setVisible(true);

    const captured = (window as unknown as Record<string, unknown>)
      .__pwaInstallPrompt as BeforeInstallPromptEvent | null;
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

  async function handleClick() {
    const prompt = deferredPrompt.current;
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        deferredPrompt.current = null;
        setVisible(false);
      }
      return;
    }
    setShowGuide(true);
  }

  if (!visible) return null;

  return (
    <div className={className}>
      <Button
        size="lg"
        variant="outline"
        className="w-full gap-2 text-base sm:w-auto"
        onClick={handleClick}
      >
        <Smartphone className="h-5 w-5" />
        Instalar no celular
      </Button>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar o app</DialogTitle>
          </DialogHeader>
          {platform === "ios" ? (
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <span>
                  Toca no botão{" "}
                  <span className="font-medium text-foreground">
                    Compartilhar
                  </span>{" "}
                  (o quadradinho com a seta pra cima)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </span>
                <span>
                  Rola pra baixo e toca em{" "}
                  <span className="font-medium text-foreground">
                    Adicionar à Tela de Início
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                <span>
                  Toca em{" "}
                  <span className="font-medium text-foreground">
                    Adicionar
                  </span>{" "}
                  e pronto
                </span>
              </li>
            </ol>
          ) : (
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <span>
                  Toca no menu{" "}
                  <span className="font-medium text-foreground">⋮</span> (três
                  pontinhos no canto superior)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </span>
                <span>
                  Toca em{" "}
                  <span className="font-medium text-foreground">
                    Instalar aplicativo
                  </span>{" "}
                  ou{" "}
                  <span className="font-medium text-foreground">
                    Adicionar à tela inicial
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                <span>
                  Confirma e pronto
                </span>
              </li>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
