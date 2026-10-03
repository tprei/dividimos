"use client";

import { type FormEvent, useId, useState } from "react";
import { ArrowRight, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptics } from "@/hooks/use-haptics";

interface RoomCodeEntryProps {
  onSubmit: (code: string) => void;
  pending: boolean;
  errorMessage: string | null;
}

export function RoomCodeEntry({ onSubmit, pending, errorMessage }: RoomCodeEntryProps) {
  const [value, setValue] = useState("");
  const id = useId();
  const inputId = `${id}-code`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const hasValue = value.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasValue || pending) return;
    haptics.tap();
    onSubmit(value);
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg items-center px-4 py-6 sm:px-6 sm:py-10">
      <section className="w-full min-w-0 space-y-6 rounded-3xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7" aria-labelledby={`${id}-title`}>
        <div className="space-y-4">
          <div aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground">
            <Utensils className="size-6" />
          </div>
          <div className="space-y-2">
            <h1 id={`${id}-title`} className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">Entrar na sala</h1>
            <p id={helperId} className="text-base leading-relaxed text-muted-foreground">
              Digite o código que apareceu pra quem criou a sala.
            </p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit} aria-busy={pending}>
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">Código da sala</label>
            <Input
              id={inputId}
              className="h-12 text-base motion-reduce:transition-none md:text-sm"
              placeholder="pipoca-moleza"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="go"
              disabled={pending}
              aria-invalid={errorMessage !== null}
              aria-describedby={errorMessage !== null ? `${helperId} ${errorId}` : helperId}
            />
          </div>
          {errorMessage !== null && (
            <p id={errorId} role="alert" className="text-sm leading-relaxed text-destructive-text">{errorMessage}</p>
          )}
          <Button
            type="submit"
            className="min-h-12 w-full motion-reduce:transform-none motion-reduce:transition-none"
            disabled={!hasValue || pending}
          >
            {pending ? "Abrindo..." : "Entrar"}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </form>
      </section>
    </main>
  );
}
