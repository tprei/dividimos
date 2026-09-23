"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, PartyPopper, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboardingTour } from "@/hooks/use-onboarding-tour";
import { useMounted } from "@/hooks/use-client-only";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { springs } from "@/lib/animations";
import { useBackHandler } from "@/hooks/use-back-handler";

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
    description: "O que você tem a pagar e a receber.",
    placement: "bottom",
  },
  {
    target: "[data-tour='quick-actions']",
    title: "Ações rápidas",
    description: "Contas, cupons e convites.",
    placement: "bottom",
  },
  {
    target: "[data-tour='debt-lists']",
    title: "Quem deve o quê",
    description: "Seus acertos com cada pessoa.",
    placement: "top",
  },
  {
    target: "[data-tour='nav-bar']",
    title: "Navegação",
    description: "Conversas, grupos e seu perfil.",
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
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
}

function stepRect(index: number): SpotlightRect | null {
  const step = TOUR_STEPS[index];
  if (!step) return null;
  return getTargetRect(step.target);
}

function scrollToTarget(selector: string): void {
  const el = document.querySelector(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const viewportH = window.innerHeight;
  if (rect.top < 80 || rect.bottom > viewportH - 80) {
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
  }
}

export function OnboardingTour({ userId }: { userId: string | undefined }) {
  const { shouldShow, completeTour } = useOnboardingTour(userId);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const mounted = useMounted();
  const reducedMotion = useReducedMotion();
  const card = useRef<HTMLDivElement>(null);
  useBackHandler(shouldShow, completeTour);

  const recalcTimer = useRef<ReturnType<typeof setTimeout>>(null);

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

  const recalcSpotlight = useCallback(() => {
    if (!shouldShow || showCelebration) return;
    const rect = stepRect(currentStep);
    if (rect) setSpotlight(rect);
  }, [shouldShow, currentStep, showCelebration]);

  const resolveStep = useCallback(() => {
    if (!shouldShow || showCelebration) return;
    const rect = stepRect(currentStep);
    if (rect) {
      setSpotlight(rect);
      return;
    }
    if (currentStep < TOUR_STEPS.length - 1) {
      handleNext();
    } else {
      completeTour();
    }
  }, [shouldShow, currentStep, showCelebration, handleNext, completeTour]);

  useLayoutEffect(() => {
    if (!shouldShow || showCelebration) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    scrollToTarget(step.target);

    clearTimeout(recalcTimer.current ?? undefined);
    recalcTimer.current = setTimeout(resolveStep, 350);

    return () => {
      clearTimeout(recalcTimer.current ?? undefined);
    };
  }, [shouldShow, currentStep, resolveStep, showCelebration]);

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
  useEffect(() => {
    if (spotlight && shouldShow) card.current?.focus();
  }, [spotlight, shouldShow]);

  const handleSkip = useCallback(() => {
    completeTour();
  }, [completeTour]);

  if (!mounted || !shouldShow) return null;

  const step = TOUR_STEPS[currentStep];

  const anchorTop = spotlight
    ? step.placement === "bottom" ? spotlight.top + spotlight.height + 12 : spotlight.top - 200
    : 16;
  const tooltipTop = `clamp(16px, ${anchorTop}px, calc(var(--app-viewport-height, 100dvh) - 200px))`;

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
            initial={reducedMotion ? false : { scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.snappy}
            className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-2xl"
          >
            <PartyPopper className="h-12 w-12 text-primary" />
            <p className="text-lg font-bold">Pronto!</p>
            <p className="text-sm text-muted-foreground">
              Tudo pronto pra dividir.
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
                  <rect
                    x={spotlight.left}
                    y={spotlight.top}
                    width={spotlight.width}
                    height={spotlight.height}
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
              ref={card}
              role="dialog"
              aria-modal="true"
              aria-labelledby="tour-title"
              aria-describedby="tour-description"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") handleSkip();
                if (event.key !== "Tab") return;
                const buttons = card.current?.querySelectorAll("button");
                if (!buttons?.length) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={springs.snappy}
              className="absolute left-4 right-4 mx-auto max-h-[calc(var(--app-viewport-height,100dvh)-32px)] max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl outline-none"
              style={{
                top: tooltipTop,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p id="tour-title" className="text-base font-bold">{step.title}</p>
                  <p id="tour-description" className="mt-1 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <IconButton
                  onClick={handleSkip}
                  className="ml-2 shrink-0"
                  aria-label="Pular tour"
                >
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full ${
                        i === currentStep
                          ? "w-4 bg-primary"
                          : i < currentStep
                            ? "w-1.5 bg-primary/40"
                            : "w-1.5 bg-muted-foreground/20"
                      }`}
                    />
                  ))}
                </div>
                <Button
                  onClick={handleNext}
                  size="sm"
                >
                  {currentStep === TOUR_STEPS.length - 1 ? (
                    "Concluir"
                  ) : (
                    <>
                      Próximo
                      <ChevronRight className="h-3 w-3" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
