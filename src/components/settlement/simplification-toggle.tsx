"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ListOrdered, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { springs } from "@/lib/animations";

interface SimplificationToggleProps {
  originalCount: number;
  simplifiedCount: number;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onViewSteps: () => void;
}

export function SimplificationToggle({
  originalCount,
  simplifiedCount,
  enabled,
  onToggle,
  onViewSteps,
}: SimplificationToggleProps) {
  const saved = originalCount - simplifiedCount;

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">
              Simplificar dívidas
            </p>
            <p className="text-xs text-muted-foreground">
              Menos Pix pra todo mundo
            </p>
          </div>
        </div>

        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label="Ativar simplificação de dívidas"
        />
      </div>

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-sm">
                <ListOrdered className="size-3.5 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-1.5 font-medium tabular-nums">
                  <motion.span
                    key={`orig-${originalCount}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springs.snappy}
                    className="text-muted-foreground line-through"
                  >
                    {originalCount}
                  </motion.span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <motion.span
                    key={`simp-${simplifiedCount}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springs.snappy}
                    className="text-success font-semibold"
                  >
                    {simplifiedCount}
                  </motion.span>
                  <span className="text-muted-foreground">Pix</span>
                </div>
                {saved > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={springs.bouncy}
                    className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success"
                  >
                    -{saved}
                  </motion.span>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={onViewSteps}
                className="shrink-0 text-primary h-7 px-2 text-xs"
              >
                Ver como simplificou
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
