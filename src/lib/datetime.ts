/** Brazil's primary commercial timezone (UTC-3, no DST since 2019). */
const BR_TIME_ZONE = "America/Sao_Paulo";

/**
 * Format an ISO timestamp as a pt-BR date in Brazil's timezone, independent of
 * the server's process TZ (Fly defaults to UTC). Without an explicit `timeZone`,
 * an evening Brazilian bill would render on the wrong calendar day when formatted
 * server-side.
 */
export function formatBrazilianDate(
  iso: string,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  },
): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: BR_TIME_ZONE,
    ...options,
  });
}

/**
 * Short relative label for activity timestamps: "agora", "12min", "3h", "5d",
 * then an absolute day/month once a week has passed.
 */
export function formatRelativeDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
