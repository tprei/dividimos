"use client";

import { useId } from "react";
import { AlertCircle, Check, KeyRound, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/shared/skeleton";

export type LinkedAccountProvider = "apple" | "google";
export type LinkFailureReason = "busy" | "network" | "linking_disabled" | "identity_in_use" | "rejected";

export interface LinkedAccountsSectionProps {
  providers: { apple: boolean; google: boolean } | null;
  loadFailed: boolean;
  onRetryLoad: () => void;
  linkable: { apple: boolean; google: boolean };
  pendingProvider: LinkedAccountProvider | null;
  onLink: (provider: LinkedAccountProvider) => void;
  error: string | null;
  onDismissError: () => void;
}

const PROVIDERS: { id: LinkedAccountProvider; label: string }[] = [
  { id: "apple", label: "Apple" },
  { id: "google", label: "Google" },
];

export function linkFailureMessage(reason: LinkFailureReason): string {
  switch (reason) {
    case "busy":
      return "Já tem uma conexão em andamento. Espere ela terminar para tentar de novo.";
    case "network":
      return "Não deu para conectar agora. Confira sua internet e tente de novo.";
    case "linking_disabled":
      return "Conectar contas está temporariamente indisponível. Tente mais tarde.";
    case "identity_in_use":
      return "Essa conta Apple ou Google já está conectada a outra conta do Dividimos. As duas contas do Dividimos não podem ser juntadas.";
    case "rejected":
      return "Não deu para concluir a conexão. Tente de novo com a conta que você quer conectar.";
  }
}

export function LinkedAccountsSection({
  providers,
  loadFailed,
  onRetryLoad,
  linkable,
  pendingProvider,
  onLink,
  error,
  onDismissError,
}: LinkedAccountsSectionProps): React.JSX.Element {
  const headingId = useId();
  const descriptionId = useId();

  return (
    <section className="mt-6" aria-labelledby={headingId} aria-describedby={descriptionId}>
      <h2 id={headingId} className="mb-3 text-lg font-bold">Contas conectadas</h2>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <p id={descriptionId} className="px-4 pt-4 pb-3 text-sm leading-relaxed text-muted-foreground">
          Conecte Apple e Google para entrar na sua conta do Dividimos com qualquer uma delas.
          Isso nunca junta duas contas diferentes do Dividimos.
        </p>
        {error && (
          <div role="alert" className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 py-3 pr-1 pl-3 text-destructive-text">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{error}</p>
            <Button type="button" variant="ghost" size="icon-lg" className="-my-2 shrink-0 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text" aria-label="Dispensar aviso de conexão" onClick={onDismissError}>
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
        {providers === null && loadFailed && (
          <div className="space-y-3 border-t p-4">
            <p role="alert" className="text-sm leading-relaxed text-destructive-text">
              Não deu para carregar as contas conectadas.
            </p>
            <Button type="button" variant="outline" size="lg" className="w-full" onClick={onRetryLoad}>
              Tentar novamente
            </Button>
          </div>
        )}
        {providers === null && !loadFailed && (
          <div role="status" aria-label="Carregando contas conectadas" aria-busy="true" className="divide-y">
            {PROVIDERS.map(({ id }) => (
              <div key={id} className="flex min-h-18 items-center gap-3 border-t px-4 py-3">
                <Skeleton className="size-10 shrink-0 rounded-xl" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-11 w-25" />
              </div>
            ))}
          </div>
        )}
        {providers !== null && (
          <ul>
            {PROVIDERS.map(({ id, label }) => {
              const pending = pendingProvider === id;
              return (
                <li key={id} className="flex min-h-18 items-center gap-3 border-t px-4 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <KeyRound className="size-5" aria-hidden="true" />
                  </div>
                  <span className="min-w-0 flex-1 text-base font-semibold">{label}</span>
                  {providers[id] ? (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-success-text">
                      <Check className="size-4" aria-hidden="true" />
                      Conectada
                    </span>
                  ) : linkable[id] ? (
                    <Button type="button" variant="outline" size="lg" className="min-w-25 text-sm" disabled={pendingProvider !== null} aria-busy={pending} aria-label={pending ? `Conectando ${label}` : `Conectar conta ${label}`} onClick={() => onLink(id)}>
                      {pending && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
                      {pending ? "Conectando..." : "Conectar"}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">Indisponível</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <span role="status" className="sr-only">
          {pendingProvider ? `Conectando conta ${pendingProvider === "apple" ? "Apple" : "Google"}.` : ""}
        </span>
      </div>
    </section>
  );
}
