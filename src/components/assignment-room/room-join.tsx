"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ScreenHeader } from "@/components/shared/screen-header";
import { haptics } from "@/hooks/use-haptics";
import { useBackHandler } from "@/hooks/use-back-handler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Presentation-only identity resolved at the route load boundary so the join
 * form can match the invitee: an authenticated account skips the guest-name
 * field, an anonymous visitor keeps it. It never grants access — the join RPC
 * still identifies the actor server-side.
 */
export type RoomJoinIdentity =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "guest" }
  | { status: "account"; name: string | null };

interface RoomJoinProps {
  identity: RoomJoinIdentity;
  onRetryIdentity: () => void;
  pending: boolean;
  errorMessage?: string | null;
  onJoin: (displayName: string) => void;
  onBack?: () => void;
}

export function RoomJoin({
  identity,
  onRetryIdentity,
  pending,
  errorMessage,
  onJoin,
  onBack,
}: RoomJoinProps) {
  const [displayName, setDisplayName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const dirty = displayName.trim().length > 0;
  const leave = () => {
    if (pending || (dirty && !window.confirm("Sair sem entrar na sala?"))) return;
    onBack?.();
  };
  useBackHandler(Boolean(onBack) && dirty, leave);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleGuestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = displayName.trim();
    if (normalized.length === 0 || normalized.length > 80) {
      setLocalError("O nome precisa ter de 1 a 80 caracteres.");
      return;
    }
    setLocalError(null);
    haptics.tap();
    onJoin(normalized);
  }

  const firstName = identity.status === "account" ? identity.name?.trim().split(/\s+/)[0] : null;

  return (
    <section className="mx-auto w-full max-w-md space-y-6 rounded-2xl border bg-card p-4">
      <div className="-mx-4 -mt-4">
        <ScreenHeader title="Sala de itens" subtitle="Cada um escolhe sua parte" back={Boolean(onBack)} onBack={leave} />
      </div>

      {identity.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Verificando sua conta...
        </p>
      )}

      {identity.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p role="alert" className="text-sm text-destructive-text">
            {identity.message}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 px-2 text-muted-foreground motion-reduce:transform-none motion-reduce:transition-none"
            onClick={onRetryIdentity}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {identity.status === "guest" && (
        <form className="space-y-3" onSubmit={handleGuestSubmit} noValidate>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="room-display-name">
              Seu nome
            </label>
            <div className="flex gap-2">
              <Input
                id="room-display-name"
                className="h-12 min-w-0 flex-1 text-base md:text-sm"
                placeholder="Como te chamam?"
                value={displayName}
                maxLength={80}
                autoComplete="name"
                disabled={pending}
                aria-invalid={Boolean(localError || errorMessage)}
                aria-describedby={localError || errorMessage ? "room-join-error" : undefined}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setLocalError(null);
                }}
              />
              <Button
                type="submit"
                variant="default"
                className="min-h-12 px-4 motion-reduce:transform-none motion-reduce:transition-none"
                aria-label="Entrar na sala"
                disabled={pending}
              >
                {pending ? "Entrando..." : "Entrar"}
              </Button>
            </div>
          </div>
          {(localError || errorMessage) && (
            <p id="room-join-error" role="alert" className="text-sm text-destructive-text">
              {localError || errorMessage}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Você pode vincular sua conta depois.
          </p>
        </form>
      )}

      {identity.status === "account" && (
        <div className="space-y-4">
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive-text">
              {errorMessage}
            </p>
          )}
          <Button
            type="button"
            className="min-h-12 w-full font-semibold motion-reduce:transform-none motion-reduce:transition-none"
            aria-label="Entrar na sala"
            disabled={pending}
            onClick={() => { haptics.tap(); onJoin(""); }}
          >
            {pending ? "Entrando..." : firstName ? `Entrar como ${firstName}` : "Entrar"}
          </Button>
        </div>
      )}
    </section>
  );
}
