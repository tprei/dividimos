"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  Home,
  MessageSquare,
  Plus,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import toast from "react-hot-toast";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { DashboardSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { UnreadBadge } from "@/components/shared/unread-badge";
import { IconButton } from "@/components/ui/icon-button";
import { springs } from "@/lib/animations";
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
import {
  ScreenHeaderActionsContext,
  ScreenRefreshContext,
} from "@/components/shared/screen-header-actions";
import { PullToRefreshIndicator } from "@/components/shared/pull-to-refresh-indicator";
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


function NavBar({ keyboardOpen }: { keyboardOpen: boolean }) {
  const pathname = usePathname();
  const unreadTotal = useAppStore(selectUnreadTotal);
  const reducedMotion = useReducedMotion();

  if (keyboardOpen || pathname.startsWith(WIZARD_PREFIX)) return null;

  return (
    <nav
      aria-label="Navegação principal"
      data-tour="nav-bar"
      className="z-30 shrink-0 border-t border-border glass md:order-first md:w-28 md:border-t-0 md:border-r compact:md:order-last compact:md:w-full compact:md:border-r-0 compact:md:border-t"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2 md:h-full md:flex-col md:justify-start md:gap-3 md:px-3 md:py-6 compact:h-12 compact:md:flex-row compact:md:justify-around compact:md:gap-0 compact:md:px-2 compact:md:py-0">
        {navItems.map((item) => {
          const isActive = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
          const primary = "primary" in item;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={primary ? "Nova conta" : `${item.label}${"badge" in item && unreadTotal > 0 ? `, ${unreadTotal} não lidas` : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => haptics.tap()}
              className={cn(
                "relative flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:w-full md:py-3 compact:md:w-auto compact:md:py-0",
                primary && "-mt-5 md:order-first md:mt-0 md:mb-3 compact:mt-0 compact:md:order-none compact:md:mb-0 max-md:group-has-[[data-slot=chat-composer]]/shell:mt-0",
                isActive ? "text-primary-text" : "text-muted-foreground",
              )}
            >
              {isActive && <motion.span
                layoutId={reducedMotion ? undefined : "shell-nav-active"}
                transition={springs.snappy}
                className="absolute inset-0 rounded-2xl bg-primary/10"
              />}
              <motion.span
                whileTap={reducedMotion ? undefined : { scale: 0.92 }}
                className={cn("relative flex items-center justify-center", primary && "gradient-primary size-14 rounded-2xl text-gradient-foreground shadow-lg shadow-primary/20 compact:size-11 max-md:group-has-[[data-slot=chat-composer]]/shell:size-11")}
              >
                <item.icon aria-hidden="true" className={primary ? "size-6" : "size-5"} strokeWidth={isActive ? 2.5 : 2} />
                {"badge" in item && <UnreadBadge count={unreadTotal} />}
              </motion.span>
              <span className="relative text-xs font-semibold compact:hidden">{item.label}</span>
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

/** Damped pull distance at which a release refreshes. */
const PULL_THRESHOLD = 96;
/** The damped distance approaches but never passes this. */
const PULL_MAX = 140;
/** Finger travel over which resistance builds; ~210px reaches the threshold. */
const PULL_RESISTANCE = 180;
/**
 * A scroller must have been resting at the top this long before the touch:
 * a fling that just reached the top is still the user scrolling, not pulling.
 */
const PULL_REST_MS = 300;

/**
 * `onRefresh` settles when the refresh is over.
 *
 * A pull is only a refresh when the user clearly meant one: a single finger,
 * starting on an eligible list that has been resting at its very top, moving
 * down far enough against growing resistance and released there. Everything
 * else (sliders, horizontal swipes, a second finger, a nested scroller, an
 * open overlay, scrolling back up to the top) is ordinary interaction and
 * must not reload the screen.
 */
function usePullToRefresh(onRefresh: () => Promise<void>, enabled: boolean) {
  const [firing, setFiring] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const start = useRef({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);
  const isDragging = useRef(false);
  const distance = useRef(0);
  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY);

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

  const onScroll = useCallback(() => {
    lastScrollAt.current = performance.now();
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      cancel();
      if (!enabled) return;
      if (e.touches.length !== 1) return;

      const source = e.target as HTMLElement | null;
      if (source?.closest(PULL_BLOCKING_SELECTOR)) return;

      const container = e.currentTarget as HTMLElement;
      if (container.scrollTop >= 1) return;
      if (performance.now() - lastScrollAt.current < PULL_REST_MS) return;
      // A gesture that starts inside a nested scroller belongs to that
      // scroller, even when the shell happens to be at the top.
      if (source && nearestScrollable(source, container) !== container) return;

      const touch = e.touches[0];
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

      const next = PULL_MAX * (1 - Math.exp(-deltaY / PULL_RESISTANCE));
      if ((distance.current < PULL_THRESHOLD) !== (next < PULL_THRESHOLD)) haptics.selectionChanged();
      distance.current = next;
      setPullDistance(next);
    },
    [cancel],
  );

  const onTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    const travelled = distance.current;
    cancel();
    if (travelled < PULL_THRESHOLD || !enabled) return;

    haptics.impact();
    setFiring(true);
    try {
      await onRefresh();
    } finally {
      setFiring(false);
    }
  }, [cancel, enabled, onRefresh]);

  return {
    firing,
    pullDistance,
    handlers: { onScroll, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel },
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { keyboardOpen } = useAppViewport();
  const navHidden = keyboardOpen || pathname.startsWith(WIZARD_PREFIX);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsAnchor, setNotificationsAnchor] = useState<HTMLElement | null>(null);
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

  const reportBootstrapError = useCallback(
    (err: unknown) => {
      if (err instanceof LedgerError && err.code === "unauthenticated") {
        router.replace("/auth");
        return;
      }
      toast.error(ledgerErrorMessage(err));
    },
    [router],
  );

  useEffect(() => {
    void useAppStore.persist.rehydrate();

    const stopRealtime = startRealtime();
    const stopAuth = attachAuthListener(() => {
      router.replace("/auth");
    }, reportBootstrapError);

    return () => {
      stopRealtime();
      stopAuth();
    };
  }, [router, reportBootstrapError]);

  useEffect(() => {
    if (!hydrated) return;
    runBootstrap().catch(reportBootstrapError);
    return attachVisibilityRefresh(reportBootstrapError);
  }, [hydrated, reportBootstrapError]);

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
      <IconButton
        aria-label={`Notificações${invitations.length > 0 ? `, ${invitations.length} convite${invitations.length > 1 ? "s" : ""}` : ""}${unread ? ", atividade nova" : ""}`}
        onClick={(event) => {
          haptics.tap();
          setNotificationsAnchor(event.currentTarget);
          setNotificationsOpen(true);
        }}
        className="relative rounded-full"
      >
        <Bell className="size-5" aria-hidden="true" />
        {invitations.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-bold text-destructive-foreground"
          >
            {invitations.length}
          </span>
        )}
        {unread && <span aria-hidden="true" className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary" />}
      </IconButton>
    ),
    [invitations.length, unread],
  );

  // A preview anchored to a header button must not survive the navigation
  // that unmounts that button.
  useEffect(() => {
    setNotificationsOpen(false);
    setNotificationsAnchor(null);
  }, [pathname]);

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
    }
  }, [router]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  // One refresh at a time, whether the header button or the pull asked for it.
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      // Success feedback would otherwise fire on a failed refresh and tell the
      // user their data is current when it is not.
      if (await handleRefresh()) haptics.success();
      else haptics.error();
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [handleRefresh]);

  const screenRefresh = useMemo(
    () => ({ refreshing, refresh: () => void refresh() }),
    [refreshing, refresh],
  );

  // Wizards, detail screens, and settings never reload from a pull: the
  // gesture there is almost always a mis-read scroll or slider drag.
  const refreshEligible =
    PULL_TO_REFRESH_PATHS[pathname] === true && !keyboardOpen && !notificationsOpen && !refreshing;

  const { firing, pullDistance, handlers: pullHandlers } = usePullToRefresh(refresh, refreshEligible);
  const reducedMotion = useReducedMotion() ?? false;
  // The content opens a gap the indicator rides in; at the threshold, and
  // while the pull's refresh runs, the gap fits the whole pill.
  let contentOffset = 0;
  if (!reducedMotion) contentOffset = firing ? 52 : pullDistance * 0.55;

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
                ? "Parece que você está sem conexão."
                : ledgerErrorMessage(new LedgerError(bootstrapErrorCode))
            }
            onRetry={retryBootstrap}
            retrying={retrying}
          />
        </div>
      ) : (
        <div className="group/shell relative flex h-full min-h-0 flex-col overflow-hidden bg-background md:flex-row compact:md:flex-col">

          <PullToRefreshIndicator
            distance={pullDistance}
            threshold={PULL_THRESHOLD}
            contentOffset={contentOffset}
            refreshing={firing}
          />

          <main
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain"
            {...pullHandlers}
          >
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
            <ScreenHeaderActionsContext.Provider
              value={
                  !pathname.startsWith("/app/bill/new")
                  ? unifiedBell
                  : null
              }
            >
              <ScreenRefreshContext.Provider value={screenRefresh}>
                <motion.div
                  animate={{ y: contentOffset }}
                  transition={pullDistance > 0 ? { duration: 0 } : springs.snappy}
                  className={cn("mx-auto h-full w-full max-w-lg md:max-w-2xl md:[&>*]:max-w-none", !navHidden && "pb-4 compact:pb-0 has-[[data-slot=chat-composer]]:pb-0")}
                >
                  {children}
                </motion.div>
              </ScreenRefreshContext.Provider>
            </ScreenHeaderActionsContext.Provider>
          </main>

          <OnboardingTour userId={me?.id} />

          <NotificationsSheet
            open={notificationsOpen}
            onOpenChange={setNotificationsOpen}
            invitations={invitations}
            meId={me.id}
            anchor={notificationsAnchor}
          />

          <NavBar keyboardOpen={keyboardOpen} />
        </div>
      )}
    </>
  );
}
