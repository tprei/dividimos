"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTASection() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="rounded-3xl gradient-primary p-10 text-white shadow-xl shadow-primary/20"
    >
      <h2 className="text-2xl font-bold sm:text-3xl">Bora rachar?</h2>
      <p className="mx-auto mt-3 max-w-sm text-white/80">
        Entra aí, é de graça.
      </p>
      <Link href="/app">
        <Button
          size="lg"
          variant="secondary"
          className="mt-6 gap-2 text-base font-semibold"
        >
          Bora lá
          <ArrowRight className="h-5 w-5" />
        </Button>
      </Link>
    </motion.div>
  );
}
