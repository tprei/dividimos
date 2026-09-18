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
  const meta =
    title !== null
      ? `«${title}» · ainda não está no grupo`
      : itemCount > 0
        ? `${itemCount === 1 ? "1 item" : `${itemCount} itens`} · ainda não está no grupo`
        : "Ainda não está no grupo";

  return (
    <motion.div
      role="status"
      variants={fadeUp()}
      initial="hidden"
      animate="visible"
      className="rounded-2xl border bg-card px-4 py-3 ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold leading-snug">Continuar de onde você parou?</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <Money
          cents={totalCents}
          className="shrink-0 text-base font-semibold text-primary-text"
        />
      </div>
      <div className="mt-2.5 flex gap-2">
        <Button className="flex-1 rounded-lg" size="lg" onClick={onContinue}>
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
