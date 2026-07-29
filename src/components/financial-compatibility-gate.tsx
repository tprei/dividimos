"use client";

import { Loader2, RefreshCw, WrenchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  fetchFinancialCompatibility,
  type FinancialCompatibilityCheck,
  type NativePlatformVersion,
} from "@/lib/financial-compatibility";

type GateState = Readonly<{ status: "checking" }> | FinancialCompatibilityCheck;

function messageFor(check: Extract<FinancialCompatibilityCheck, { compatible: false }>): string {
  switch (check.issue.code) {
    case "maintenance":
      return "Estamos em manutenção rápida. Volte em alguns minutos.";
    case "native_outdated":
      return "Uma nova versão do app é necessária. Atualize pela loja para continuar.";
    case "native_unknown":
      return "Não foi possível verificar a versão do app. Tente novamente.";
    case "schema_outdated":
      return "Uma nova versão está disponível. Atualize a página para continuar.";
    case "unreachable":
      return "Não foi possível confirmar a disponibilidade do app agora.";
  }
}

/**
 * Issue #477 preparatory gate: blocks the authenticated app (and every
 * Supabase query its children would otherwise issue) behind the
 * `/api/runtime/financial-compatibility` manifest. Renders only a
 * blocking maintenance/update/error state on any incompatibility; never
 * renders `children` until the check passes.
 */
export function FinancialCompatibilityGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // A failure importing the module or calling it means the native
      // platform/version cannot be proven web-safe. Fail closed as an
      // unverifiable native build rather than silently defaulting to web,
      // which would let a genuinely outdated native app bypass the gate.
      let native: NativePlatformVersion = { onNative: false };
      try {
        const { getNativeVersionCode } = await import("@/lib/capacitor");
        native = await getNativeVersionCode();
      } catch {
        native = { onNative: true, versionCode: null };
      }
      const result = await fetchFinancialCompatibility(native);
      if (!cancelled) setState(result);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if ("status" in state) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.compatible) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <WrenchIcon className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-xs text-sm text-muted-foreground">{messageFor(state)}</p>
        <button
          onClick={() => {
            setState({ status: "checking" });
            window.location.reload();
          }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
