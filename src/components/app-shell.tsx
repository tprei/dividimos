"use client";

import { motion } from "framer-motion";
import { Home, Loader2, Plus, Receipt, RefreshCw, Settings, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Logo } from "@/components/shared/logo";
import { UserProvider } from "@/contexts/user-context";
import { haptics } from "@/hooks/use-haptics";
import type { User as UserType } from "@/types";

const navItems = [
  { href: "/app", icon: Home, label: "Início" },
  { href: "/app/bills", icon: Receipt, label: "Contas" },
  { href: "/app/bill/new", icon: Plus, label: "Nova", primary: true },
  { href: "/app/groups", icon: Users, label: "Grupos" },
  { href: "/app/profile", icon: User, label: "Perfil" },
];

function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/50 safe-bottom">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.href);

          if (item.primary) {
            return (
              <Link key={item.href} href={item.href} onClick={() => haptics.tap()}>
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
              onClick={() => haptics.tap()}
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
  );
}

function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const threshold = 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    if (scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      isDragging.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.4, threshold * 1.5));
    } else {
      isDragging.current = false;
      setPullDistance(0);
    }
  }, [threshold]);

  const onTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (pullDistance >= threshold) {
      haptics.impact();
      setPulling(true);
      setPullDistance(0);
      await onRefresh();
      haptics.success();
      setPulling(false);
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, onRefresh]);

  return { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd };
}

export function AppShell({
  initialUser,
  children,
}: {
  initialUser: UserType | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("app-refresh"));
    router.refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }, [router]);

  const { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(handleRefresh);

  return (
    <UserProvider initialUser={initialUser}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="sticky top-0 z-40 glass border-b border-border/50">
          <div className="flex h-14 items-center justify-between px-4">
            <Logo size="sm" />
            <div className="flex items-center gap-1">
              <InstallPrompt />
              <Link
                href="/app/settings"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </header>

        {(pulling || pullDistance > 0) && (
          <div className="flex justify-center py-2">
            <Loader2 className={`h-5 w-5 text-muted-foreground ${pulling ? "animate-spin" : ""}`} style={{ opacity: pulling ? 1 : pullDistance / 80 }} />
          </div>
        )}

        <main
          className="flex-1 pb-20"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {children}
        </main>

        <NavBar />
      </div>
    </UserProvider>
  );
}
