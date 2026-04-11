"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, PartyPopper, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboardingTour } from "@/hooks/use-onboarding-tour";

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: "top" | "bottom";
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "[data-tour='balance-card']",
    title: "Seu saldo",
    description:
      "Aqui você vê quanto deve ou tem a receber. Toque no olho para esconder o valor.",
    placement: "bottom",
  },
  {
    target: "[data-tour='quick-actions']",
    title: "Ações rápidas",
    description:
      "Crie uma nova conta, escaneie um cupom, acesse seus grupos ou leia um convite por QR code.",
    placement: "bottom",
  },
  {
    target: "[data-tour='debt-tabs']",
    title: "Quem deve o quê",
    description:
      "Alterne entre o que você deve e o que te devem. Toque em uma dívida para gerar o Pix.",
    placement: "top",
  },
  {
    target: "[data-tour='nav-bar']",
    title: "Navegação",
    description:
      "Use a barra para ir ao início, ver contas, criar despesas, acessar grupos ou seu perfil.",
    placement: "top",
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const BORDER_RADIUS = 16;

function getTargetRect(selector: string): SpotlightRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top - PADDING + window.scrollY,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
}

function scrollToTarget(selector: string): void {
  const el = document.querySelector(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const viewportH = window.innerHeight;
  if (rect.top < 80 || rect.bottom > viewportH - 80) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function OnboardingTour({ userId }: { userId: string | undefined }) {
  const { shouldShow, completeTour } = useOnboardingTour(userId);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recalcTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const recalcSpotlight = useCallback(() => {
    if (!shouldShow || showCelebration) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;
    const rect = getTargetRect(step.target);
    if (rect) setSpotlight(rect);
  }, [shouldShow, currentStep, showCelebration]);

  useLayoutEffect(() => {
    if (!shouldShow || showCelebration) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    scrollToTarget(step.target);

    if (recalcTimer.current) clearTimeout(recalcTimer.current);
    recalcTimer.current = setTimeout(recalcSpotlight, 350);

    return () => {
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
    };
  }, [shouldShow, currentStep, recalcSpotlight, showCelebration]);

  useEffect(() => {
    if (!shouldShow) return;
    const handler = () => recalcSpotlight();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler);
    };
  }, [shouldShow, recalcSpotlight]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      setShowCelebration(true);
      setTimeout(() => {
        setShowCelebration(false);
        completeTour();
      }, 2000);
    }
  }, [currentStep, completeTour]);

  const handleSkip = useCallback(() => {
    completeTour();
  }, [completeTour]);

  if (!mounted || !shouldShow) return null;

  const step = TOUR_STEPS[currentStep];

  const tooltipTop =
    step.placement === "bottom" && spotlight
      ? spotlight.top + spotlight.height + 12 - window.scrollY
      : undefined;
  const tooltipBottom =
    step.placement === "top" && spotlight
      ? window.innerHeight - (spotlight.top - 12 - window.scrollY)
      : undefined;

  return createPortal(
    <AnimatePresence mode="wait">
      {showCelebration ? (
        <motion.div
          key="celebration"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-2xl"
          >
            <PartyPopper className="h-12 w-12 text-primary" />
            <p className="text-lg font-bold">Pronto!</p>
            <p className="text-sm text-muted-foreground">
              Agora é só dividir as contas.
            </p>
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          key="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999]"
          style={{ pointerEvents: "auto" }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            style={{ pointerEvents: "none" }}
          >
            <defs>
              <mask id="tour-spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {spotlight && (
                  <motion.rect
                    initial={{ opacity: 0 }}
                    animate={{
                      x: spotlight.left,
                      y: spotlight.top - window.scrollY,
                      width: spotlight.width,
                      height: spotlight.height,
                      opacity: 1,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    rx={BORDER_RADIUS}
                    ry={BORDER_RADIUS}
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.6)"
              mask="url(#tour-spotlight-mask)"
              style={{ pointerEvents: "auto" }}
              onClick={handleNext}
            />
          </svg>

          {spotlight && (
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: step.placement === "bottom" ? -8 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15, duration: 0.3 }}
              className="absolute left-4 right-4 mx-auto max-w-sm rounded-2xl bg-card p-4 shadow-2xl"
              style={{
                top: tooltipTop,
                bottom: tooltipBottom,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-bold">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <button
                  onClick={handleSkip}
                  className="ml-2 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
                  aria-label="Pular tour"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${
                        i === currentStep
                          ? "w-4 bg-primary"
                          : i < currentStep
                            ? "w-1.5 bg-primary/40"
                            : "w-1.5 bg-muted-foreground/20"
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {currentStep === TOUR_STEPS.length - 1 ? (
                    "Concluir"
                  ) : (
                    <>
                      Próximo
                      <ChevronRight className="h-3 w-3" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
