import { safeRedirect } from "@/lib/safe-redirect";

/** Set once the device reaches the login slide; a cookie so the server can pick the first slide without a flash. */
export const INTRO_SEEN_COOKIE = "dividimos_intro_seen";

export interface IntroVisit {
  seen: boolean;
  next: string | null;
  error: string | null;
}

/** The story plays on a device's first visit, unless the visitor came for a specific destination or back from a failed sign-in. */
export function shouldPlayIntro(visit: IntroVisit): boolean {
  return !visit.seen && visit.error === null && safeRedirect(visit.next) === "/app";
}
