"use client";

import { motion } from "framer-motion";
import { QrCode, ScanLine, Users } from "lucide-react";

const steps = [
  {
    icon: ScanLine,
    title: "Escaneie",
    desc: "Aponte para o QR code da nota fiscal ou tire uma foto. Os itens aparecem automaticamente.",
    color: "text-primary bg-primary/10",
  },
  {
    icon: Users,
    title: "Atribua",
    desc: "Cada pessoa toca nos itens que consumiu. Divida itens compartilhados por porcentagem ou valor.",
    color: "text-chart-2 bg-chart-2/10",
  },
  {
    icon: QrCode,
    title: "Pague",
    desc: "QR codes Pix gerados automaticamente com o valor exato. Copie, cole, liquidou.",
    color: "text-chart-3 bg-chart-3/10",
  },
];

export function HowItWorksSection() {
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
          Como funciona
        </h2>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Tres passos, zero complicacao
        </p>
      </motion.div>

      <div className="mt-14 grid gap-8 sm:grid-cols-3">
        {steps.map((step, idx) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: idx * 0.15, duration: 0.5 }}
            className="relative rounded-2xl border bg-background p-6"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className={`rounded-xl p-2.5 ${step.color}`}>
                <step.icon className="h-6 w-6" />
              </div>
              <span className="text-sm font-bold text-muted-foreground">
                {idx + 1}
              </span>
            </div>
            <h3 className="text-lg font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {step.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </>
  );
}
