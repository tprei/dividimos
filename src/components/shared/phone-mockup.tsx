"use client";

import { motion } from "framer-motion";

interface PhoneMockupProps {
  children: React.ReactNode;
}

export function PhoneMockup({ children }: PhoneMockupProps) {
  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-[280px] sm:w-[320px]"
    >
      <div className="rounded-[2.5rem] border-[6px] border-foreground/10 bg-card shadow-2xl shadow-primary/10 overflow-hidden">
        <div className="mx-auto mt-3 h-6 w-24 rounded-full bg-foreground/10" />
        <div className="p-4 pt-3">{children}</div>
        <div className="h-4" />
      </div>
    </motion.div>
  );
}
