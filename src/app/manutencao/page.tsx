import { WrenchIcon } from "lucide-react";

/**
 * Server-rendered, data-free landing page for the proxy's compatibility
 * redirect (see `evaluateServerFinancialGate` in
 * `@/lib/financial-compatibility` and `src/lib/supabase/middleware.ts`).
 *
 * The proxy redirects here BEFORE any protected route's server component
 * renders, so an incompatible/maintenance window can never let a
 * financial page's server-side data fetch execute — this page itself
 * never touches Supabase/PostgREST or any user data, matching the
 * manifest route's own "never lie about its own status" guarantee.
 */

const MESSAGES: Record<string, string> = {
  maintenance: "Estamos em manutenção rápida. Volte em alguns minutos.",
  schema_outdated: "Uma nova versão está disponível. Atualize a página para continuar.",
};

const DEFAULT_MESSAGE = "O app está temporariamente indisponível. Tente novamente em instantes.";

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && MESSAGES[reason]) || DEFAULT_MESSAGE;

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <WrenchIcon className="h-8 w-8 text-muted-foreground" />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
