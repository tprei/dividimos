"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { DebtGraph } from "./debt-graph";
import { Button } from "@/components/ui/button";
import { springs } from "@/lib/animations";
import { formatBRL } from "@/lib/currency";
import type { SimplificationResult } from "@/lib/simplify";
import type { User } from "@/types";

interface SimplificationViewerProps {
  result: SimplificationResult;
  participants: User[];
}

const SWIPE_THRESHOLD = 50;

function getUserName(userId: string, participants: User[]): string {
  return participants.find((p) => p.id === userId)?.name.split(" ")[0] || "?";
}

export function SimplificationViewer({
  result,
  participants,
}: SimplificationViewerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const touchStartX = useRef<number | null>(null);

  const totalSteps = result.steps.length;
  const step = result.steps[currentStep];
  const isFinal = currentStep === totalSteps - 1;
  const isFirst = currentStep === 0;

  function goTo(index: number) {
    if (index < 0 || index >= totalSteps) return;
    setDirection(index > currentStep ? 1 : -1);
    setCurrentStep(index);
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      goTo(currentStep + (delta > 0 ? 1 : -1));
    }
    touchStartX.current = null;
  }

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 40 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -40 }),
  };

  const fadingEdges = step.removedEdges?.map((e) => ({
    from: e.fromUserId,
    to: e.toUserId,
  })) || [];

  const highlightEdge = step.addedEdge
    ? { from: step.addedEdge.fromUserId, to: step.addedEdge.toUserId }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Passo {currentStep + 1} de {totalSteps}
        </span>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Ir para passo ${i + 1}`}
              className="rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <motion.div
                animate={{
                  width: i === currentStep ? 16 : 6,
                  backgroundColor:
                    i === currentStep
                      ? "var(--color-primary)"
                      : "var(--color-muted-foreground)",
                  opacity: i === currentStep ? 1 : 0.4,
                }}
                transition={springs.snappy}
                className="h-1.5 rounded-full"
              />
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={springs.gentle}
            className="flex flex-col items-center gap-4"
          >
            <DebtGraph
              participants={participants}
              edges={step.edges}
              highlightEdge={highlightEdge}
              fadingEdges={fadingEdges}
            />

            <div className="w-full rounded-xl bg-muted/50 p-3">
              <p className="text-center text-sm font-medium">
                {step.description}
              </p>
              {!isFirst && !isFinal && step.removedEdges && step.removedEdges.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  {step.removedEdges.map((e, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive line-through">
                      {getUserName(e.fromUserId, participants)} → {getUserName(e.toUserId, participants)}
                    </span>
                  ))}
                  {step.addedEdge && (
                    <>
                      <ArrowRight className="h-3 w-3" />
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success font-medium">
                        {getUserName(step.addedEdge.fromUserId, participants)} → {getUserName(step.addedEdge.toUserId, participants)} ({formatBRL(step.addedEdge.amountCents)})
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {isFinal && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.soft}
                className="w-full rounded-2xl border-2 border-dashed border-success/30 bg-success/5 px-4 py-4 text-center"
              >
                <p className="text-sm font-semibold">Resultado</p>
                <div className="mt-1 flex items-center justify-center gap-2 text-lg font-bold">
                  <span className="tabular-nums text-muted-foreground line-through">
                    {result.originalCount}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="tabular-nums text-success">
                    {result.simplifiedCount}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    transacoes
                  </span>
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => goTo(currentStep - 1)}
          disabled={currentStep === 0}
          aria-label="Passo anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="outline"
          size="icon"
          onClick={() => goTo(currentStep + 1)}
          disabled={currentStep === totalSteps - 1}
          aria-label="Proximo passo"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
