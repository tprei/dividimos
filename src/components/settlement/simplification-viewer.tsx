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
              edges={[
                ...step.edges,
                ...(step.removedEdges || []),
              ]}
              highlightEdge={highlightEdge}
              fadingEdges={fadingEdges}
              dimOthers={!isFirst && !isFinal && (fadingEdges.length > 0 || !!highlightEdge)}
            />

            <div className="w-full rounded-xl bg-muted/50 p-4">
              {isFirst && (
                <p className="text-center text-sm font-medium">
                  {step.description}
                </p>
              )}

              {!isFirst && step.paymentEdge && (() => {
                const pe = step.paymentEdge;
                const paymentFrom = getUserName(pe.fromUserId, participants);
                const paymentTo = getUserName(pe.toUserId, participants);
                return (
                  <div className="space-y-3">
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                        Pagamento
                      </p>
                      <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                          {paymentFrom.charAt(0)}
                        </span>
                        <span className="font-semibold text-primary">
                          {paymentFrom}
                        </span>
                        <span className="text-xs text-muted-foreground">pagou</span>
                        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-sm font-bold text-primary tabular-nums">
                          {formatBRL(pe.amountCents)}
                        </span>
                        <span className="text-xs text-muted-foreground">a</span>
                        <span className="font-semibold text-primary">
                          {paymentTo}
                        </span>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                          {paymentTo.charAt(0)}
                        </span>
                      </span>
                    </div>

                    <div className="flex justify-center">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                        <ArrowRight className="h-3 w-3 text-muted-foreground rotate-90" />
                      </div>
                    </div>

                    {step.addedEdge ? (() => {
                      const ae = step.addedEdge!;
                      const resultFrom = getUserName(ae.fromUserId, participants);
                      const resultTo = getUserName(ae.toUserId, participants);
                      const consolidated = step.edges.find(
                        (e) => e.fromUserId === ae.fromUserId && e.toUserId === ae.toUserId,
                      );
                      const totalAmount = consolidated?.amountCents ?? ae.amountCents;
                      return (
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            Resultado
                          </p>
                          <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-[10px] font-bold text-success">
                              {resultFrom.charAt(0)}
                            </span>
                            <span className="font-semibold text-success">{resultFrom}</span>
                            <span className="text-success/60">→</span>
                            <span className="font-semibold text-success">{resultTo}</span>
                            <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-xs font-bold text-success tabular-nums">
                              {formatBRL(totalAmount)}
                            </span>
                          </span>
                        </div>
                      );
                    })() : (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Resultado
                        </p>
                        <span className="text-xs font-medium text-success">
                          Dividas se cancelam
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {!isFirst && !step.paymentEdge && step.removedEdges && step.removedEdges.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Antes
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {step.removedEdges.map((e, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1.5 text-xs"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/20 text-[9px] font-bold text-destructive">
                            {getUserName(e.fromUserId, participants).charAt(0)}
                          </span>
                          <span className="font-medium text-destructive line-through">
                            {getUserName(e.fromUserId, participants)}
                          </span>
                          <span className="text-destructive/50">→</span>
                          <span className="font-medium text-destructive line-through">
                            {getUserName(e.toUserId, participants)}
                          </span>
                          <span className="text-[10px] text-destructive/70 tabular-nums">
                            {formatBRL(e.amountCents)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                      <ArrowRight className="h-3 w-3 text-primary rotate-90" />
                    </div>
                  </div>

                  {step.addedEdge && (() => {
                    const ae = step.addedEdge!;
                    const fromName = getUserName(ae.fromUserId, participants);
                    const toName = getUserName(ae.toUserId, participants);
                    const consolidated = step.edges.find(
                      (e) => e.fromUserId === ae.fromUserId && e.toUserId === ae.toUserId,
                    );
                    const totalAmount = consolidated?.amountCents ?? ae.amountCents;
                    const mergedAmount = ae.amountCents;
                    const preExisting = totalAmount - mergedAmount;
                    const hasPreExisting = preExisting > 1;

                    return (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Depois
                        </p>
                        <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-4 py-2 text-sm">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/20 text-[10px] font-bold text-success">
                            {fromName.charAt(0)}
                          </span>
                          <span className="font-semibold text-success">
                            {fromName}
                          </span>
                          <span className="text-success/60">→</span>
                          <span className="font-semibold text-success">
                            {toName}
                          </span>
                          <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-xs font-bold text-success tabular-nums">
                            {formatBRL(totalAmount)}
                          </span>
                        </span>
                        {hasPreExisting && (
                          <p className="text-[11px] text-muted-foreground">
                            {fromName} ja devia {formatBRL(preExisting)} para {toName} + {formatBRL(mergedAmount)} desta simplificacao
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {!step.addedEdge && (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Resultado
                      </p>
                      <span className="text-xs font-medium text-success">
                        Dividas se cancelam
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!isFirst && !step.paymentEdge && (!step.removedEdges || step.removedEdges.length === 0) && (
                <p className="text-center text-sm font-medium">
                  {step.description}
                </p>
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
