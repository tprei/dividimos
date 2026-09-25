"use client";

import { motion } from "framer-motion";
import { FileText } from "lucide-react";
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
  const draftName =
    title ?? (itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}` : "Conta sem título");

  return (
    <motion.div
      role="status"
      aria-label={`Rascunho ${draftName}`}
      variants={fadeUp()}
      initial="hidden"
      animate="visible"
      className="flex min-h-12 items-center gap-2 rounded-[0.75rem] border border-border bg-card px-2.5 py-1.5"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-sm" title={draftName}>
        <span className="font-semibold">{draftName}</span>
        <span className="text-muted-foreground">
          {" · "}
          <Money cents={totalCents} className="text-sm" />
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" onClick={onContinue}>
          Continuar
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscardRequest}>
          Descartar
        </Button>
      </div>
    </motion.div>
  );
}
