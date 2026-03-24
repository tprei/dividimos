"use client";

import { motion } from "framer-motion";
import { CreditCard, ScanLine } from "lucide-react";
import type { BillType } from "@/types";

interface BillTypeSelectorProps {
  onSelect: (billType: BillType) => void;
}

const options: {
  type: BillType;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  examples: string;
}[] = [
  {
    type: "single_amount",
    icon: CreditCard,
    title: "Valor unico",
    subtitle: "Um valor total para dividir",
    examples: "Airbnb, Uber, assinatura, voo, presente",
  },
  {
    type: "itemized",
    icon: ScanLine,
    title: "Varios itens",
    subtitle: "Conta detalhada com itens",
    examples: "Restaurante, bar, mercado, delivery",
  },
];

export function BillTypeSelector({ onSelect }: BillTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Que tipo de conta?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha como voce quer dividir.
        </p>
      </div>

      <div className="grid gap-3">
        {options.map((opt, idx) => (
          <motion.button
            key={opt.type}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08, duration: 0.3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(opt.type)}
            className="group flex items-start gap-4 rounded-2xl border bg-card p-5 text-left transition-colors hover:border-primary/30"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <opt.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">{opt.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {opt.subtitle}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground/70">
                {opt.examples}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
