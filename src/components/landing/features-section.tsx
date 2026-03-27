"use client";

import { motion } from "framer-motion";
import { Camera, Check, Receipt, Split } from "lucide-react";

const features = [
  {
    icon: Receipt,
    title: "Nota fiscal inteligente",
    desc: "Extrai itens direto da NFC-e ou da foto do cupom. Sem digitar nada.",
  },
  {
    icon: Camera,
    title: "OCR brasileiro",
    desc: "Motor treinado para papel termico, abreviacoes de PDV e formatacao em Real.",
  },
  {
    icon: Split,
    title: "Divisao justa",
    desc: "Taxa de servico proporcional, couvert por pessoa. Matematica exata ate o centavo.",
  },
  {
    icon: Check,
    title: "Liquidacao instantanea",
    desc: "Pix Copia e Cola gerado no device. Sem intermediario, sem custodia, sem taxa.",
  },
];

export function FeaturesSection() {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Por que Pixwise?
        </h2>
      </motion.div>

      <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
        {features.map((feature, idx) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: idx * 0.1, duration: 0.5 }}
            className="flex gap-4 rounded-xl border bg-card p-5"
          >
            <div className="shrink-0 rounded-lg bg-primary/10 p-2.5 text-primary">
              <feature.icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{feature.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}
