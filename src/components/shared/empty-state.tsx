"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { springs } from "@/lib/animations";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.snappy}
      className="flex flex-col items-center px-4 py-8 text-center"
    >
      <div className="rounded-xl bg-muted/50 p-3">
        <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-[260px] text-sm text-muted-foreground">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-4 gap-2" size="sm">
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
}
