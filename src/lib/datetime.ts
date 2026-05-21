/** Brazil's primary commercial timezone (UTC-3, no DST since 2019). */
export const BR_TIME_ZONE = "America/Sao_Paulo";

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
