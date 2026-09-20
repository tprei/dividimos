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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { Logo } from "@/components/shared/logo";
import { DashboardSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { haptics } from "@/hooks/use-haptics";
import { useAppViewport } from "@/hooks/use-app-viewport";
import { hasUnreadActivity, newestActivityAt } from "@/lib/activity-badge";
import { hasNativePushConsent } from "@/lib/push/native-consent";
import { registerNativePushToken } from "@/lib/push/native-registration";
import { attachAuthListener } from "@/lib/sync/auth";
import { attachVisibilityRefresh, runBootstrap } from "@/lib/sync/bootstrap";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { cn } from "@/lib/utils";
import { startRealtime } from "@/lib/sync/realtime";
import { loadActivity } from "@/lib/sync/refresh";
import { selectPendingInvitations, selectUnreadTotal } from "@/stores/app-selectors";
import { ScreenHeaderActionsContext } from "@/components/shared/screen-header-actions";
import { NotificationsSheet } from "@/components/dashboard/notifications-sheet";
import { useAppStore } from "@/stores/app-store";

const WIZARD_PREFIX = "/app/bill/new";

const navItems = [
  { href: "/app", icon: Home, label: "Início" },
  {
    href: "/app/conversations",
    icon: MessageSquare,
    label: "Conversas",
    badge: true as const,
  },
  { href: WIZARD_PREFIX, icon: Plus, label: "Nova", primary: true },
  { href: "/app/groups", icon: Users, label: "Grupos" },
  { href: "/app/profile", icon: User, label: "Perfil" },
];

const SCREEN_HEADER_PREFIXES = ["/app/conversations", "/app/groups", "/app/bill", "/app/profile"] as const;

export function usesScreenHeader(pathname: string): boolean {
  if (pathname === "/app") return true;
  return SCREEN_HEADER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function NavBar({ keyboardOpen }: { keyboardOpen: boolean }) {
  const pathname = usePathname();
  const unreadTotal = useAppStore(selectUnreadTotal);

  if (keyboardOpen || pathname.startsWith(WIZARD_PREFIX)) return null;

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
              <Link
                key={item.href}
                href={item.href}
                aria-label="Nova conta"
                onClick={() => haptics.tap()}
                className="-mt-5 flex flex-col items-center gap-0.5 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <motion.div
                  whileTap={{ scale: 0.92 }}
                  className="gradient-primary flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg shadow-primary/30"
                >
                  <item.icon className="h-6 w-6 text-gradient-foreground" strokeWidth={2.5} />
                </motion.div>
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              </Link>
            );
          }

          const showBadge = "badge" in item && item.badge;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => haptics.tap()}
              className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <motion.div whileTap={{ scale: 0.9 }} className="relative">
                <item.icon
                  className={`h-5 w-5 transition-colors ${
                    isActive ? "text-primary-text" : "text-muted-foreground"
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {showBadge && <UnreadBadge count={unreadTotal} />}
              </motion.div>
              <span
                className={`text-xs font-medium transition-colors ${
                  isActive ? "text-primary-text" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </span>
              <span className={`mt-0.5 h-0.5 w-4 rounded-full ${isActive ? "bg-primary-text" : "bg-transparent"}`} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Nearest ancestor that actually scrolls vertically, stopping at `container`.
 * A pull that starts inside one belongs to that element, not to the shell.
 */
function nearestScrollable(from: HTMLElement, container: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from;
  while (node && node !== container) {
    const overflowY = window.getComputedStyle(node).overflowY;
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    if (scrolls && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return container;
}

/** Routes where a top-edge pull means "reload this list". */
const PULL_TO_REFRESH_PATHS: Record<string, true> = {
  "/app": true,
  "/app/groups": true,
  "/app/conversations": true,
  "/app/bills": true,
  "/app/charges": true,
  "/app/activity": true,
};

/** Controls the gesture never starts on: they own their own drag or press. */
const PULL_BLOCKING_SELECTOR =
  'input, textarea, select, button, a, label, [contenteditable="true"], [role="slider"], [data-no-pull]';

/** A pull must begin this close to the top of the scroll container. */
const PULL_START_ZONE_PX = 64;

/**
 * `onRefresh` resolves true only when the refresh actually succeeded.
 *
 * A pull is only a refresh when the user clearly meant one: a single finger,
 * starting at the very top of an eligible list, moving down. Everything else
 * (sliders, horizontal swipes, a second finger, a nested scroller, an open
 * overlay) is ordinary interaction and must not reload the screen.
 */
function usePullToRefresh(onRefresh: () => Promise<boolean>, enabled: boolean) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const start = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);
  const isDragging = useRef(false);
  const distance = useRef(0);
  const refreshing = useRef(false);
  const threshold = 80;

  const cancel = useCallback(() => {
    isDragging.current = false;
    touchId.current = null;
    distance.current = 0;
    setPullDistance(0);
  }, []);

  // Losing eligibility mid-gesture (navigation, keyboard, an overlay opening)
  // must abandon the pull rather than complete it on release.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      cancel();
      if (!enabled || refreshing.current) return;
      if (e.touches.length !== 1) return;

      const source = e.target as HTMLElement | null;
      if (source?.closest(PULL_BLOCKING_SELECTOR)) return;

      const container = e.currentTarget as HTMLElement;
      if (container.scrollTop > 1) return;
      // A gesture that starts inside a nested scroller belongs to that
      // scroller, even when the shell happens to be at the top.
      if (source && nearestScrollable(source, container) !== container) return;

      const touch = e.touches[0];
      const bounds = container.getBoundingClientRect();
      if (touch.clientY - bounds.top > PULL_START_ZONE_PX) return;

      start.current = { x: touch.clientX, y: touch.clientY };
      touchId.current = touch.identifier;
      isDragging.current = true;
    },
    [cancel, enabled],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging.current) return;
      if (e.touches.length !== 1 || e.touches[0].identifier !== touchId.current) {
        cancel();
        return;
      }

      const touch = e.touches[0];
      const deltaY = touch.clientY - start.current.y;
      const deltaX = touch.clientX - start.current.x;
      if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
        cancel();
        return;
      }

      const next = Math.min(deltaY * 0.4, threshold * 1.5);
      distance.current = next;
      setPullDistance(next);
    },
    [cancel],
  );

  const onTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    const travelled = distance.current;
    const eligible = enabled && !refreshing.current;
    cancel();
    if (travelled < threshold || !eligible) return;

    haptics.impact();
    refreshing.current = true;
    setPulling(true);
    try {
      // Success feedback would otherwise fire on a failed refresh and tell the
      // user their data is current when it is not.
      if (await onRefresh()) haptics.success();
    } finally {
      refreshing.current = false;
      setPulling(false);
    }
  }, [cancel, enabled, onRefresh]);

  return { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { keyboardOpen } = useAppViewport();
  const navHidden = keyboardOpen || pathname.startsWith(WIZARD_PREFIX);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const invitations = useAppStore(selectPendingInvitations);

  const hydrated = useAppStore((s) => s.hydrated);
  const me = useAppStore((s) => s.me);
  const bootstrapStatus = useAppStore((s) => s.bootstrapStatus);
  const bootstrapErrorCode = useAppStore((s) => s.bootstrapErrorCode);
  const lastBootstrappedAccountId = useAppStore((s) => s.lastBootstrappedAccountId);
  const groups = useAppStore(useShallow((s) => s.groups));
  const activityViewedAt = useAppStore(useShallow((s) => s.activityViewedAt));

  // Known-good means this account's own bootstrap committed. A persisted `me`
  // alone proves nothing: it may belong to a previous account or a read that
  // never succeeded.
  const knownGood = me !== null && lastBootstrappedAccountId === me.id;

  const [retrying, setRetrying] = useState(false);
  const retryBootstrap = useCallback(() => {
    setRetrying(true);
    runBootstrap()
      .catch((err) => {
        if (err instanceof LedgerError && err.code === "unauthenticated") {
          router.replace("/auth");
          return;
        }
        toast.error(ledgerErrorMessage(err));
      })
      .finally(() => setRetrying(false));
  }, [router]);

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
    // Only an explicitly decoded, committed profile may route to onboarding: a
    // failed profile read must never look like "not onboarded".
    if (hydrated && knownGood && bootstrapStatus === "ready" && me && !me.onboarded) {
      // Carry where they were headed, so onboarding returns them to it
      // instead of dropping them on the dashboard.
      const destination = `${pathname}${window.location.search}`;
      router.replace(`/auth/onboard?next=${encodeURIComponent(destination)}`);
    }
  }, [hydrated, knownGood, bootstrapStatus, me, router, pathname]);

  useEffect(() => {
    // FCM tokens rotate while the app is closed. Refreshing here means an
    // opted-in device is reachable from the next cold start, instead of only
    // after the user happens to open Settings or a group.
    if (!knownGood || !me || !hasNativePushConsent(me.id)) return;
    void registerNativePushToken().catch(() => {
      // A failed refresh leaves the previous token registered; the next
      // startup or an explicit visit to Settings tries again.
    });
  }, [knownGood, me]);

  // The badge is derived from authoritative snapshots and this account's own
  // recorded view, so there is no second unread store to fall out of sync.
  const unread = useMemo(() => {
    if (!knownGood || me === null) return false;
    return hasUnreadActivity(newestActivityAt(groups), activityViewedAt[me.id]);
  }, [knownGood, me, groups, activityViewedAt]);

  const unifiedBell = useMemo(
    () => (
      <button
        type="button"
        aria-label={`Notificações${invitations.length > 0 ? `, ${invitations.length} convite${invitations.length > 1 ? "s" : ""}` : ""}${unread ? ", atividade nova" : ""}`}
        onClick={() => {
          haptics.tap();
          setNotificationsOpen(true);
        }}
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Bell className="size-5" aria-hidden="true" />
        {invitations.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
          >
            {invitations.length}
          </span>
        )}
        {unread && <span aria-hidden="true" className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary" />}
      </button>
    ),
    [invitations.length, unread],
  );

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

  const handleRefresh = useCallback(async (): Promise<boolean> => {
    setRefreshing(true);
    try {
      const shouldRefreshActivity = useAppStore.getState().activity.read.status !== "idle";
      await Promise.all([
        runBootstrap(),
        shouldRefreshActivity ? loadActivity() : Promise.resolve(),
      ]);
      return true;
    } catch (err) {
      if (err instanceof LedgerError && err.code === "unauthenticated") {
        router.replace("/auth");
        return false;
      }
      toast.error(ledgerErrorMessage(err));
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  // Wizards, detail screens, and settings never reload from a pull: the
  // gesture there is almost always a mis-read scroll or slider drag.
  const refreshEligible =
    PULL_TO_REFRESH_PATHS[pathname] === true && !keyboardOpen && !notificationsOpen;

  const { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } =
    usePullToRefresh(handleRefresh, refreshEligible);

  return (
    <>
      {!hydrated || (!knownGood && bootstrapStatus !== "error") ? (
        <div className="px-4 py-6">
          <DashboardSkeleton />
        </div>
      ) : !knownGood ? (
        <div className="flex h-full min-h-0 flex-col items-center justify-center">
          <SyncErrorState
            title="Não conseguimos carregar sua conta"
            message={
              bootstrapErrorCode === null
                ? "Verifique sua conexão e tente novamente."
                : ledgerErrorMessage(new LedgerError(bootstrapErrorCode))
            }
            onRetry={retryBootstrap}
            retrying={retrying}
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
          {bootstrapStatus === "error" && (
            <div
              role="alert"
              className="flex items-center justify-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-1.5 text-center"
            >
              <span className="text-xs text-muted-foreground">
                Mostrando dados salvos.
              </span>
              <button
                type="button"
                onClick={retryBootstrap}
                disabled={retrying}
                className="-my-2 px-2 py-2 text-xs font-medium text-primary-text transition-colors hover:text-primary-text/80 disabled:opacity-50"
              >
                {retrying ? "Atualizando..." : "Tentar novamente"}
              </button>
            </div>
          )}
          {!usesScreenHeader(pathname) && (
          <header className="sticky top-0 z-40 glass border-b border-border/50">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo size="sm" />
              <div className="flex items-center gap-1">
                <InstallPrompt />
                <Link
                  href="/app/search"
                  aria-label="Buscar"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Search className="h-4 w-4" />
                </Link>
                <Link
                  href="/app/settings"
                  aria-label="Configurações"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Settings className="h-4 w-4" />
                </Link>
                {refreshEligible && (
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-label="Atualizar"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {refreshing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </button>
                )}
                {unifiedBell}
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
            className={cn("flex-1 overflow-y-auto overscroll-y-contain", !navHidden && "pb-20")}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
          >
            <ScreenHeaderActionsContext.Provider
              value={
                usesScreenHeader(pathname) &&
                  !pathname.startsWith("/app/bill/new") &&
                  pathname !== "/app"
                  ? unifiedBell
                  : null
              }
            >
              {children}
            </ScreenHeaderActionsContext.Provider>
          </main>

          <OnboardingTour userId={me?.id} />

          <NotificationsSheet
            open={notificationsOpen}
            onOpenChange={setNotificationsOpen}
            invitations={invitations}
            meId={me.id}
          />

          <NavBar keyboardOpen={keyboardOpen} />
        </div>
      )}
    </>
  );
}
