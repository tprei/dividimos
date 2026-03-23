"use client";

import { motion } from "framer-motion";
import {
  Home,
  Plus,
  Receipt,
  User,
} from "lucide-react";
import Link from "next/link";
import { DevTestButtons } from "@/components/shared/dev-test-buttons";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/logo";

const navItems = [
  { href: "/app", icon: Home, label: "Inicio" },
  { href: "/app/bills", icon: Receipt, label: "Contas" },
  { href: "/app/bill/new", icon: Plus, label: "Nova", primary: true },
  { href: "/app/profile", icon: User, label: "Perfil" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 glass border-b border-border/50">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo size="sm" />
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>
      <DevTestButtons />

      <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/50">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/app"
                ? pathname === "/app"
                : pathname.startsWith(item.href);

            if (item.primary) {
              return (
                <Link key={item.href} href={item.href}>
                  <motion.div
                    whileTap={{ scale: 0.92 }}
                    className="gradient-primary -mt-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg shadow-primary/30"
                  >
                    <item.icon className="h-6 w-6 text-white" strokeWidth={2.5} />
                  </motion.div>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-0.5"
              >
                <motion.div whileTap={{ scale: 0.9 }}>
                  <item.icon
                    className={`h-5 w-5 transition-colors ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                </motion.div>
                <span
                  className={`text-[10px] font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
