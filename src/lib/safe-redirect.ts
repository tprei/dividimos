const SAFE_RE = /^\/(?![/\\])/;

export function safeRedirect(next: string | null | undefined, fallback = "/app"): string {
  if (!next) return fallback;
  if (next.includes("://") || next.startsWith("//") || next.startsWith("\\")) {
    return fallback;
  }
  if (!SAFE_RE.test(next)) return fallback;
  return next;
}
