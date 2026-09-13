"use client";

import { motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ContactRowSkeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import type { UserProfile } from "@/types/ledger";

interface AddParticipantByHandleProps {
  onAdd: (profile: UserProfile) => void;
  onCancel: () => void;
  excludeIds: string[];
}

/**
 * The searched handle travels with its result, so a late reply for a handle
 * the user has moved on from can never be shown or added. A failed lookup is
 * its own state: absence of a user and inability to ask are different answers.
 */
type LookupState =
  | { status: "idle" }
  | { status: "loading"; handle: string }
  | { status: "found"; handle: string; profile: UserProfile }
  | { status: "not_found"; handle: string }
  | { status: "failed"; handle: string };

export function AddParticipantByHandle({
  onAdd,
  onCancel,
  excludeIds,
}: AddParticipantByHandleProps) {
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<LookupState>({ status: "idle" });
  // The RPC client has no cancellation, so the guard is the generation: a
  // superseded search still completes, it just never speaks.
  const generationRef = useRef(0);

  const search = useCallback(async () => {
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) return;

    generationRef.current += 1;
    const generation = generationRef.current;

    setState({ status: "loading", handle: trimmed });

    let profile: UserProfile | null = null;
    try {
      profile = await lookupUserByHandle(trimmed);
    } catch {
      if (generationRef.current !== generation) return;
      setState({ status: "failed", handle: trimmed });
      return;
    }

    if (generationRef.current !== generation) return;
    setState(
      profile
        ? { status: "found", handle: trimmed, profile }
        : { status: "not_found", handle: trimmed },
    );
  }, [handle]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter obeys the same rule as the button: one search at a time.
    if (e.key !== "Enter" || state.status === "loading" || !handle.trim()) return;
    void search();
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      className="overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Adicionar por handle</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5">
          <span className="text-sm text-muted-foreground">@</span>
          <input
            autoFocus
            placeholder="handle do usuario"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.replace(/ /g, "."));
              setState({ status: "idle" });
            }}
            onKeyDown={handleKeyDown}
            className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Button
          type="button"
          size="icon"
          aria-label="Buscar handle"
          onClick={() => void search()}
          disabled={state.status === "loading" || !handle.trim()}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {state.status === "loading" && (
        <div className="mt-3">
          <ContactRowSkeleton />
        </div>
      )}

      {state.status === "not_found" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhum usuario encontrado com @{state.handle}
        </p>
      )}

      {/* A lookup that could not run is not an answer about who exists. */}
      {state.status === "failed" && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">
            Não foi possível buscar @{state.handle}.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void search()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {state.status === "found" && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <UserAvatar name={state.profile.name} avatarUrl={state.profile.avatarUrl} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{state.profile.name}</p>
            <p className="text-xs text-muted-foreground">@{state.profile.handle}</p>
          </div>
          {excludeIds.includes(state.profile.id) ? (
            <span className="text-xs text-muted-foreground">Ja adicionado</span>
          ) : (
            <Button size="sm" onClick={() => onAdd(state.profile)}>
              Adicionar
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
