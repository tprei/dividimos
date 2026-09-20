"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { Capacitor } from "@capacitor/core";
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

/** iOS home-screen launches report installation here, not via display-mode. */
interface StandaloneNavigator extends Navigator {
  standalone?: boolean;
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (Capacitor.isNativePlatform()) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as StandaloneNavigator).standalone === true;
}

function isInstallableBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (isInstalled()) return false;
  return /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}

function detectPlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

export function InstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);

  const installed = useRef(false);

  useEffect(() => {
    // Visibility is recomputed, never written during render: an iPhone that
    // launched from the home screen must not show an install button even when
    // its display-mode query disagrees with navigator.standalone.
    const sync = () => {
      const installable = !installed.current && isInstallableBrowser();
      setVisible(installable);
      setPlatform(installable ? detectPlatform() : null);
      if (!installable) {
        deferredPrompt.current = null;
        setShowGuide(false);
      }
    };

    sync();

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

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    standaloneQuery.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    // `appinstalled` is the authoritative signal; the display-mode query can
    // lag behind it by a navigation.
    const onAppInstalled = () => {
      installed.current = true;
      sync();
    };

    window.addEventListener("appinstalled", onAppInstalled);
    // Installing happens outside the page; returning to it is when the app
    // finds out.
    window.addEventListener("visibilitychange", sync);

    return () => {
      standaloneQuery.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("visibilitychange", sync);
    };
  }, []);

  async function handleClick() {
    const prompt = deferredPrompt.current;
    if (!prompt) {
      setShowGuide(true);
      return;
    }

    // The browser allows one prompt() per event. Clearing it first means a
    // dismissal, or a rejected prompt, leaves the button on the manual guide
    // instead of calling a consumed event a second time.
    deferredPrompt.current = null;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setVisible(false);
    } catch {
      // A refused prompt is not an error the user can act on; the guide is
      // the next thing they see if they click again.
    }
  }

  if (!visible) return null;

  return (
    <>
      <button
        onClick={handleClick}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Instalar no celular"
      >
        <Smartphone className="h-4 w-4" />
      </button>

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
    </>
  );
}
