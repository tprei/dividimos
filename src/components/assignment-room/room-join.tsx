"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { ScreenHeader } from "@/components/shared/screen-header";
import { haptics } from "@/hooks/use-haptics";
import { useBackHandler } from "@/hooks/use-back-handler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoomJoinIntro, RoomJoinSteps } from "./room-join-intro";
import { roomJoinFirstName } from "./room-join-name";

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

  const firstName = identity.status === "account" ? roomJoinFirstName(identity.name) : null;
  let joinLabel = firstName ? `Entrar como ${firstName}` : "Entrar";
  if (pending) joinLabel = "Entrando...";

  return (
    <section className="mx-auto w-full max-w-4xl space-y-3 text-card-foreground">
      <ScreenHeader title="Sala de itens" back={Boolean(onBack)} onBack={leave} />
      <div className="grid gap-5 md:grid-cols-2 md:items-center md:gap-8">
        <RoomJoinIntro />
        <div className="min-w-0 space-y-5 rounded-3xl border bg-card p-5 shadow-sm sm:p-7 md:col-start-2 md:row-span-2 md:row-start-1 md:p-8" aria-busy={pending}>
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight">Sua parte começa aqui</h2>
            <p className="text-sm text-muted-foreground">Entre pra ver os itens e escolher os seus.</p>
          </div>

      {identity.status === "loading" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
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
            <div className="space-y-3">
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
                className="min-h-12 w-full px-4 motion-reduce:transform-none motion-reduce:transition-none"
                aria-label="Entrar na sala"
                disabled={pending}
              >
                {pending ? "Entrando..." : "Entrar"}
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Button>
            </div>
          </div>
          {(localError || errorMessage) && (
            <p id="room-join-error" role="alert" className="text-sm text-destructive-text">
              {localError || errorMessage}
            </p>
          )}
          <p className="text-center text-sm text-muted-foreground">
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
            <span className="truncate">{joinLabel}</span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Button>
        </div>
      )}
        </div>
        <RoomJoinSteps />
      </div>
    </section>
  );
}
