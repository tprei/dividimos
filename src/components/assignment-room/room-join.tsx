"use client";

import { FormEvent, useState } from "react";
import { Logo } from "@/components/shared/logo";
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
}: RoomJoinProps) {
  const [displayName, setDisplayName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleGuestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = displayName.trim();
    if (normalized.length === 0 || normalized.length > 80) {
      setLocalError("Digite um nome com até 80 caracteres.");
      return;
    }
    setLocalError(null);
    onJoin(normalized);
  }

  const firstName = identity.status === "account" ? identity.name?.trim().split(/\s+/)[0] : null;

  return (
    <section className="mx-auto w-full max-w-md space-y-6">
      <header className="flex min-h-11 items-center">
        <Logo />
      </header>
      <div className="gradient-primary rounded-2xl p-6 text-primary-foreground">
        <p className="text-sm font-medium">Sala de itens</p>
        <h1 className="mt-3 font-heading text-3xl font-bold leading-tight tracking-tight">
          Entre pra marcar o que consumiu
        </h1>
      </div>

      {identity.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Verificando sua conta...
        </p>
      )}

      {identity.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p role="alert" className="text-sm text-destructive">
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
                variant="outline"
                className="min-h-12 px-4 motion-reduce:transform-none motion-reduce:transition-none"
                aria-label="Entrar na sala"
                disabled={pending}
              >
                {pending ? "Entrando..." : "Entrar"}
              </Button>
            </div>
          </div>
          {(localError || errorMessage) && (
            <p id="room-join-error" role="alert" className="text-sm text-destructive">
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
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <Button
            type="button"
            className="min-h-12 w-full font-semibold motion-reduce:transform-none motion-reduce:transition-none"
            aria-label="Entrar na sala"
            disabled={pending}
            onClick={() => onJoin("")}
          >
            {pending ? "Entrando..." : firstName ? `Entrar como ${firstName}` : "Entrar"}
          </Button>
        </div>
      )}
    </section>
  );
}
