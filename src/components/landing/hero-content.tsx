"use client";

import { motion } from "framer-motion";
import { Split, Zap } from "lucide-react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import Link from "next/link";
import { PhoneMockup } from "@/components/shared/phone-mockup";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  }),
};

const mockItems = [
  { name: "Picanha 400g", price: 8900, users: ["A", "B"] },
  { name: "Coca-Cola 600ml", price: 1200, users: ["A"] },
  { name: "Cerveja Brahma", price: 1400, users: ["B", "C"] },
  { name: "Batata frita", price: 3200, users: ["A", "B", "C"] },
];

export function HeroContent() {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className="max-w-xl">
        <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" />
            Pix na hora, sem enrolação
          </span>
        </motion.div>

        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
        >
          Racha a conta{" "}
          <span className="text-primary">sem drama</span>
        </motion.h1>

        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-5 text-lg text-muted-foreground"
        >
          Lê a nota, cada um marca o que comeu, e a galera paga no Pix na hora. Sem banco, sem enrolação.
        </motion.p>

        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-8 flex flex-wrap gap-3"
        >
          <Link href="/app">
            <Button size="lg" className="gap-2 text-base">
              <Split className="h-5 w-5" />
              Rachar uma conta
            </Button>
          </Link>
          <Link href="/demo">
            <Button size="lg" variant="outline" className="text-base">
              Ver como funciona
            </Button>
          </Link>
          <InstallPrompt />
        </motion.div>
      </div>

      <div className="hidden lg:block">
        <PhoneMockup>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Churrascaria</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                3 na mesa
              </span>
            </div>
            <div className="space-y-2">
              {mockItems.map((item, idx) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + idx * 0.12, duration: 0.5 }}
                  className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{item.name}</p>
                    <div className="mt-0.5 flex gap-1">
                      {item.users.map((u) => (
                        <span
                          key={u}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary"
                        >
                          {u}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs font-semibold tabular-nums">
                    {formatBRL(item.price)}
                  </span>
                </motion.div>
              ))}
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="flex items-center justify-between border-t border-border pt-2"
            >
              <span className="text-xs text-muted-foreground">
                Total + 10% do garçom
              </span>
              <span className="text-sm font-bold">{formatBRL(16280)}</span>
            </motion.div>
          </div>
        </PhoneMockup>
      </div>
    </div>
  );
}
