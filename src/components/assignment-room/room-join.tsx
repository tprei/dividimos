"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RoomJoinProps {
  pending: boolean;
  errorMessage?: string | null;
  onJoin: (displayName: string) => void;
  onBack?: () => void;
}

export function RoomJoin({ pending, errorMessage, onJoin, onBack }: RoomJoinProps) {
  const [displayName, setDisplayName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = displayName.trim();
    if (normalized.length === 0 || normalized.length > 80) {
      setLocalError("Digite um nome com até 80 caracteres.");
      return;
    }
    setLocalError(null);
    onJoin(normalized);
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-5 rounded-2xl border bg-card p-5">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Entre para escolher seus itens</h1>
        <p className="text-sm text-muted-foreground">
          Você não precisa criar uma conta. Use o nome que o pessoal conhece.
        </p>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="room-display-name">
            Seu nome
          </label>
          <Input
            id="room-display-name"
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
      </form>
    </section>
  );
}
