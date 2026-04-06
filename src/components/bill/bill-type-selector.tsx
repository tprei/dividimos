"use client";

import { motion } from "framer-motion";
import { Camera, CreditCard, Mic, ScanLine } from "lucide-react";
import { haptics } from "@/hooks/use-haptics";
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
  examples: string;
}[] = [
  {
    type: "single_amount",
    icon: CreditCard,
    title: "Valor único",
    subtitle: "Um total pra dividir",
    examples: "Airbnb, Uber, assinatura, voo, presente",
  },
  {
    type: "itemized",
    icon: ScanLine,
    title: "Vários itens",
    subtitle: "Conta com itens, cada um no que comeu",
    examples: "Restaurante, bar, mercado, delivery",
  },
];

export function BillTypeSelector({
  onSelect,
  onScanReceipt,
  onVoiceExpense,
}: BillTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Que tipo de conta?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha como você quer rachar.
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
            onClick={() => {
              haptics.tap();
              onSelect(opt.type);
            }}
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

        {onScanReceipt && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: options.length * 0.08, duration: 0.3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              haptics.tap();
              onScanReceipt!();
            }}
            className="group flex items-start gap-4 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-5 text-left transition-colors hover:border-primary/50"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Camera className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">Escanear nota</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Foto do cupom ou QR Code NFC-e
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground/70">
                Restaurante, bar, mercado, padaria
              </p>
            </div>
          </motion.button>
        )}

        {onVoiceExpense && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (options.length + 1) * 0.08, duration: 0.3 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              haptics.tap();
              onVoiceExpense!();
            }}
            className="group flex items-start gap-4 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-5 text-left transition-colors hover:border-primary/50"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Mic className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">Falar despesa</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Diga o que gastou e com quem
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground/70">
                &ldquo;Uber com João 25 reais&rdquo;
              </p>
            </div>
          </motion.button>
        )}
      </div>
    </div>
  );
}
