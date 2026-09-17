"use client";

import { motion } from "framer-motion";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { fadeUp } from "@/lib/animations";

export interface DraftResumeBannerProps {
  /** Already the display title: pass null when the draft never got a name. */
  title: string | null;
  itemCount: number;
  totalCents: number;
  onContinue: () => void;
  onDiscardRequest: () => void;
}

export function DraftResumeBanner({
  title,
  itemCount,
  totalCents,
  onContinue,
  onDiscardRequest,
}: DraftResumeBannerProps) {
  const summary = title ?? (itemCount > 0 ? `${itemCount === 1 ? "1 item" : `${itemCount} itens`}` : "conta sem título");
  return (
    <motion.div
      role="status"
      variants={fadeUp()}
      initial="hidden"
      animate="visible"
      className="rounded-2xl border bg-card p-4 ring-1 ring-foreground/10"
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        RASCUNHO PENDENTE
      </p>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold leading-snug">
          Continuar de onde você parou: {title === null ? summary : `«${title}»`}
        </h2>
        <Money
          cents={totalCents}
          className="shrink-0 text-base font-semibold text-primary-text"
        />
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Rascunho salvo neste navegador — ainda não é uma conta no grupo.
      </p>

      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1 rounded-lg"
          size="lg"
          onClick={onContinue}
        >
          Continuar
        </Button>
        <Button
          variant="outline"
          className="flex-1 rounded-lg"
          size="lg"
          onClick={onDiscardRequest}
        >
          Descartar
        </Button>
      </div>
    </motion.div>
  );
}
