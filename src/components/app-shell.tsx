"use client";

import { motion } from "framer-motion";
import {
  Bell,
  Home,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { Logo } from "@/components/shared/logo";
import { DashboardSkeleton } from "@/components/shared/skeleton";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { haptics } from "@/hooks/use-haptics";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";
import { hasUnreadActivity, markActivityViewed } from "@/lib/activity-badge";
import { attachAuthListener } from "@/lib/sync/auth";
import { attachVisibilityRefresh, runBootstrap } from "@/lib/sync/bootstrap";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { startRealtime } from "@/lib/sync/realtime";
import { cn } from "@/lib/utils";
import { selectUnreadTotal } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";

const navItems = [
  { href: "/app", icon: Home, label: "Início" },
  {
    href: "/app/conversations",
    icon: MessageSquare,
    label: "Conversas",
    badge: true as const,
  },
  { href: "/app/bill/new", icon: Plus, label: "Nova", primary: true },
  { href: "/app/groups", icon: Users, label: "Grupos" },
  { href: "/app/profile", icon: User, label: "Perfil" },
];

const SCREEN_HEADER_PREFIXES = ["/app/conversations", "/app/groups", "/app/bill", "/app/profile"] as const;

export function usesScreenHeader(pathname: string): boolean {
  if (pathname === "/app") return true;
  return SCREEN_HEADER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function NavBar() {
  const pathname = usePathname();
  const keyboardOpen = useKeyboardVisible();
  const unreadTotal = useAppStore(selectUnreadTotal);

  if (keyboardOpen) return null;

  return (
    <nav
      data-tour="nav-bar"
      className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/50 safe-bottom"
    >
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

          const showBadge = "badge" in item && item.badge;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => haptics.tap()}
              className="flex flex-col items-center gap-0.5"
            >
              <motion.div whileTap={{ scale: 0.9 }} className="relative">
                <item.icon
                  className={`h-5 w-5 transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {showBadge && <UnreadBadge count={unreadTotal} />}
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
    const target = e.currentTarget as HTMLElement;
    if (target.scrollTop <= 0) {
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const keyboardOpen = useKeyboardVisible();
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState(false);

  const hydrated = useAppStore((s) => s.hydrated);
  const me = useAppStore((s) => s.me);

  useEffect(() => {
    const reportBootstrapError = (err: unknown) => {
      if (err instanceof LedgerError && err.code === "unauthenticated") {
        router.replace("/auth");
        return;
      }
      toast.error(ledgerErrorMessage(err));
    };

    void useAppStore.persist.rehydrate();
    runBootstrap().catch(reportBootstrapError);

    const stopRealtime = startRealtime();
    const stopVisibility = attachVisibilityRefresh(reportBootstrapError);
    const stopAuth = attachAuthListener(() => {
      router.replace("/auth");
    }, reportBootstrapError);

    return () => {
      stopRealtime();
      stopVisibility();
      stopAuth();
    };
  }, [router]);

  useEffect(() => {
    if (hydrated && me && !me.onboarded) {
      router.replace("/auth/onboard");
    }
  }, [hydrated, me, router]);

  useEffect(() => {
    if (pathname === "/app/activity") {
      markActivityViewed();
      setUnread(false);
    } else {
      setUnread(hasUnreadActivity());
    }
  }, [pathname]);

  useEffect(() => {
    const onNewActivity = () => setUnread(hasUnreadActivity());
    window.addEventListener("activity-updated", onNewActivity);
    return () => window.removeEventListener("activity-updated", onNewActivity);
  }, []);

  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        const listener = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const url = action.notification?.data?.url;
            if (typeof url === "string" && url.startsWith("/app/")) {
              router.push(url);
            }
          },
        );
        if (cancelled) {
          await listener.remove();
        } else {
          handle = listener;
        }
      } catch {
        // Capacitor not available (e.g. web) — ignore
      }
    })();
    return () => {
      cancelled = true;
      handle?.remove().catch(() => {});
    };
  }, [router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runBootstrap();
    } catch (err) {
      if (err instanceof LedgerError && err.code === "unauthenticated") {
        router.replace("/auth");
        return;
      }
      toast.error(ledgerErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  const { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(handleRefresh);

  return (
    <>
      {!hydrated ? (
        <div className="px-4 py-6">
          <DashboardSkeleton />
        </div>
      ) : (
        <div className="flex h-dvh flex-col overflow-hidden bg-background">
          {!usesScreenHeader(pathname) && (
          <header className="sticky top-0 z-40 glass border-b border-border/50">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo size="sm" />
              <div className="flex items-center gap-1">
                <InstallPrompt />
                <Link
                  href="/app/search"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Search className="h-4 w-4" />
                </Link>
                <Link
                  href="/app/activity"
                  className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Atividade"
                >
                  <Bell className="h-4 w-4" />
                  {unread && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </Link>
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
          )}

          {(pulling || pullDistance > 0) && (
            <div className="flex justify-center py-2">
              <Loader2
                className={`h-5 w-5 text-muted-foreground ${
                  pulling ? "animate-spin" : ""
                }`}
                style={{ opacity: pulling ? 1 : pullDistance / 80 }}
              />
            </div>
          )}

          <main
            className={cn("flex-1 overflow-y-auto", !keyboardOpen && "pb-20")}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {children}
          </main>

          <OnboardingTour userId={me?.id} />

          <NavBar />
        </div>
      )}
    </>
  );
}
