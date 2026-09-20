"use client";

import { FormEvent, useState } from "react";
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

  // Loading and error render no join action at all, so only `pending` gates
  // the buttons that exist.
  const joinDisabled = pending;

  return (
    <section className="mx-auto w-full max-w-md space-y-5 rounded-2xl border bg-card p-5">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Entre para escolher seus itens</h1>
        {identity.status === "guest" && (
          <p className="text-sm text-muted-foreground">
            Você entra como convidado, sem precisar criar conta.
          </p>
        )}
        {identity.status === "account" && (
          <p className="text-sm text-muted-foreground">
            {identity.name
              ? `Você entra como ${identity.name}.`
              : "Você entra com sua conta conectada."}{" "}
            Ao registrar a conta, você recebe um convite para o grupo.
          </p>
        )}
      </div>

      {identity.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Verificando sua conta...
        </p>
      )}

      {identity.status === "error" && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {identity.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={onRetryIdentity}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {identity.status === "guest" && (
        <form className="space-y-4" onSubmit={handleGuestSubmit} noValidate>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="room-display-name">
              Seu nome
            </label>
            <Input
              id="room-display-name"
              className="min-h-11"
              value={displayName}
              maxLength={80}
              autoComplete="name"
              autoFocus
              disabled={pending}
              aria-invalid={Boolean(localError || errorMessage)}
              aria-describedby={localError || errorMessage ? "room-join-error" : undefined}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setLocalError(null);
              }}
            />
          </div>
          {(localError || errorMessage) && (
            <p id="room-join-error" role="alert" className="text-sm text-destructive">
              {localError || errorMessage}
            </p>
          )}
          <Button type="submit" className="min-h-11 w-full" disabled={pending}>
            {pending ? "Entrando..." : "Entrar na sala"}
          </Button>
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
            className="min-h-11 w-full"
            disabled={joinDisabled}
            onClick={() => onJoin("")}
          >
            {pending ? "Entrando..." : "Entrar na sala"}
          </Button>
        </div>
      )}

      {onBack && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full"
          disabled={pending}
          onClick={onBack}
        >
          Voltar
        </Button>
      )}
    </section>
  );
}
