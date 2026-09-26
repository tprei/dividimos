"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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

// Written by the inline head script in src/app/layout.tsx.
declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent | null;
  }
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

/** `badge` adds the pulsing dot the home header uses to draw the eye. */
export function InstallPrompt({ badge = false }: { badge?: boolean }) {
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

    const captured = window.__pwaInstallPrompt;
    if (captured) {
      deferredPrompt.current = captured;
      window.__pwaInstallPrompt = null;
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
      <IconButton
        aria-label="Instalar no celular"
        onClick={handleClick}
        className="relative rounded-full"
      >
        <Smartphone className="size-5" aria-hidden="true" />
        {badge && (
          <span aria-hidden="true" className="absolute right-2 top-2 flex size-2.5">
            <span className="absolute inset-0 rounded-full bg-destructive motion-safe:animate-ping" />
            <span className="relative size-2.5 rounded-full bg-destructive ring-2 ring-background" />
          </span>
        )}
      </IconButton>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar o app</DialogTitle>
          </DialogHeader>
          <ol className="list-inside list-decimal space-y-3 text-sm text-foreground marker:font-semibold marker:text-primary-text">
            {(platform === "ios"
              ? ["Compartilhar", "Adicionar à Tela de Início", "Adicionar"]
              : [
                  "Menu do navegador",
                  "Instalar aplicativo ou Adicionar à tela inicial",
                  "Confirmar",
                ]
            ).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
