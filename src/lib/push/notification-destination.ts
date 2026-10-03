import { safeRedirect } from "@/lib/safe-redirect";

/**
 * The only routes a notification payload may open: exactly the shapes
 * `event-notification.ts` produces. The payload travels through FCM/APNs and
 * is attacker-visible bytes, not app state, so anything outside this set —
 * queries, fragments, encoded traversal, foreign hosts — is dropped. The
 * destination screen itself rechecks membership before rendering anything.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const DESTINATION_PATTERNS: RegExp[] = [
  /^\/app$/,
  new RegExp(`^/app/bill/${UUID}$`),
  new RegExp(`^/app/conversations/${UUID}$`),
  new RegExp(`^/app/groups/${UUID}$`),
];

export function resolveNotificationDestination(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return DESTINATION_PATTERNS.some((pattern) => pattern.test(raw)) ? raw : null;
}

/**
 * Holds the destination of a tap that arrived before the app shell had a
 * known-good signed-in bootstrap. One slot: the newest tap wins and
 * duplicate identical events collapse into a single navigation.
 */
let heldDestination: string | null = null;

/** Validate and hold a tap destination for later replay. */
export function holdNotificationDestination(raw: unknown): boolean {
  const destination = resolveNotificationDestination(raw);
  if (destination === null) return false;
  heldDestination = destination;
  return true;
}

/** Pop the held destination, if any. */
export function takeHeldNotificationDestination(): string | null {
  const destination = heldDestination;
  heldDestination = null;
  return destination;
}

/**
 * Where a validated tap should go given the current session: straight in
 * when signed in, or through the login screen when not. `/auth` re-applies
 * `next` with the existing `safeRedirect` rules, so onboarding preserves the
 * destination.
 */
export function notificationTapHref(
  destination: string,
  signedIn: boolean,
): string {
  const target = safeRedirect(destination, "/app");
  if (!signedIn) return `/auth?next=${encodeURIComponent(target)}`;
  return target;
}

/** Forget any held destination, so it cannot replay into another account. */
export function clearHeldNotificationDestination(): void {
  heldDestination = null;
}
