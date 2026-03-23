"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  Check,
  QrCode,
  Receipt,
  ScanLine,
  Split,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { PhoneMockup } from "@/components/shared/phone-mockup";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { DEMO_ITEMS, DEMO_USERS } from "@/lib/demo-data";
import { useBillStore } from "@/stores/bill-store";

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

export default function LandingPage() {
  const router = useRouter();
  const store = useBillStore();

  const loadDemo = () => {
    const s = useBillStore.getState();
    s.setCurrentUser(DEMO_USERS[0]);
    s.createBill("Churrascaria Fogo de Chao", "Fogo de Chao - Jardins");
    s.updateBill({ serviceFeePercent: 10, fixedFees: 0 });

    for (const user of DEMO_USERS.slice(1)) {
      s.addParticipant(user);
    }

    for (const item of DEMO_ITEMS) {
      s.addItem(item);
    }

    const items = useBillStore.getState().items;
    s.splitItemEqually(items[0].id, ["user_self", "user_ana"]);
    s.splitItemEqually(items[1].id, ["user_marcos", "user_julia"]);
    s.splitItemEqually(items[2].id, ["user_self"]);
    s.splitItemEqually(items[3].id, ["user_ana", "user_marcos", "user_julia"]);
    s.splitItemEqually(items[4].id, ["user_self", "user_ana", "user_marcos", "user_julia"]);
    s.splitItemEqually(items[5].id, ["user_self", "user_marcos"]);
    s.splitItemEqually(items[6].id, ["user_self", "user_ana", "user_marcos", "user_julia"]);
    s.splitItemEqually(items[7].id, ["user_julia"]);

    s.computeLedger();
    router.push("/app/bill/demo");
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo size="sm" />
          <Link href="/app">
            <Button size="sm">
              Abrir app
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="gradient-mesh absolute inset-0 -z-10" />
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-32 sm:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div className="max-w-xl">
                <motion.div
                  custom={0}
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <Zap className="h-3 w-3" />
                    Pagamento instantaneo via Pix
                  </span>
                </motion.div>

                <motion.h1
                  custom={1}
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                  className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
                >
                  Divida a conta{" "}
                  <span className="text-primary">sem estresse</span>
                </motion.h1>

                <motion.p
                  custom={2}
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                  className="mt-5 text-lg text-muted-foreground"
                >
                  Escaneie a nota fiscal, escolha o que cada um consumiu e liquide
                  via Pix em segundos. Sem cadastro em banco, sem conta digital.
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
                      Dividir uma conta
                    </Button>
                  </Link>
                  <Button
                    size="lg"
                    variant="outline"
                    className="text-base"
                    onClick={loadDemo}
                  >
                    Experimentar demo
                  </Button>
                </motion.div>
              </div>

              <div className="hidden lg:block">
                <PhoneMockup>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Churrascaria</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        3 pessoas
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
                            <p className="truncate text-xs font-medium">
                              {item.name}
                            </p>
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
                        Total + 10% servico
                      </span>
                      <span className="text-sm font-bold">{formatBRL(16280)}</span>
                    </motion.div>
                  </div>
                </PhoneMockup>
              </div>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="border-t bg-card py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
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
              {[
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
              ].map((step, idx) => (
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
          </div>
        </section>

        <section className="border-t py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
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
              {[
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
              ].map((feature, idx) => (
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
                    <p className="mt-1 text-sm text-muted-foreground">
                      {feature.desc}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-card py-20 sm:py-28">
          <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="rounded-3xl gradient-primary p-10 text-white shadow-xl shadow-primary/20"
            >
              <h2 className="text-2xl font-bold sm:text-3xl">
                Pronto para dividir?
              </h2>
              <p className="mx-auto mt-3 max-w-sm text-white/80">
                Crie uma conta agora ou comece sem cadastro.
              </p>
              <Link href="/app">
                <Button
                  size="lg"
                  variant="secondary"
                  className="mt-6 gap-2 text-base font-semibold"
                >
                  Comecar agora
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-sm text-muted-foreground sm:px-6">
          <Logo size="sm" />
          <p>2026 Pixwise</p>
        </div>
      </footer>
    </div>
  );
}
