"use client";

import { motion } from "framer-motion";
import { Camera, ChevronRight, CreditCard, Mic, ScanLine } from "lucide-react";
import { haptics } from "@/hooks/use-haptics";
import { popIn, tapScale } from "@/lib/animations";
import type { ExpenseType } from "@/types";

interface BillTypeSelectorProps {
  onSelect: (expenseType: ExpenseType) => void;
  onScanReceipt?: () => void;
  onVoiceExpense?: () => void;
}

const options: {
  type: ExpenseType;
  icon: React.ElementType;
  title: string;
  subtitle: string;
}[] = [
  {
    type: "single_amount",
    icon: CreditCard,
    title: "Valor único",
    subtitle: "Um total pra dividir",
  },
  {
    type: "itemized",
    icon: ScanLine,
    title: "Vários itens",
    subtitle: "Cada um paga o que consumiu",
  },
];

export function BillTypeSelector({
  onSelect,
  onScanReceipt,
  onVoiceExpense,
}: BillTypeSelectorProps) {
  const shortcuts = [
    ...(onScanReceipt
      ? [{ icon: Camera, title: "Escanear nota", onClick: onScanReceipt }]
      : []),
    ...(onVoiceExpense
      ? [{ icon: Mic, title: "Falar conta", onClick: onVoiceExpense }]
      : []),
  ];
  return (
    <div className="space-y-4">
      <h2 className="px-1 text-base font-bold tracking-tight">Que tipo de conta?</h2>
      <div className="space-y-2">
        {options.map((option) => (
          <motion.button
            key={option.type}
            type="button"
            variants={popIn}
            initial="hidden"
            animate="visible"
            whileTap={{ scale: tapScale.card }}
            onClick={() => {
              haptics.selectionChanged();
              onSelect(option.type);
            }}
            className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[0.75rem] bg-primary/10 text-primary-text">
              <option.icon className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold">{option.title}</span>
              <span className="block truncate text-sm text-muted-foreground">{option.subtitle}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </motion.button>
        ))}
      </div>
      {shortcuts.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {shortcuts.map((shortcut) => (
            <motion.button
              key={shortcut.title}
              type="button"
              variants={popIn}
              initial="hidden"
              animate="visible"
              whileTap={{ scale: tapScale.icon }}
              onClick={() => {
                haptics.selectionChanged();
                shortcut.onClick();
              }}
              className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-[0.75rem] border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <shortcut.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{shortcut.title}</span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
