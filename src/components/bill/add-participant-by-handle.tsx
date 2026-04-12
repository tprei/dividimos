"use client";

import { motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ContactRowSkeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/types";
import type { Database } from "@/types/database";

type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

interface AddParticipantByHandleProps {
  onAdd: (profile: UserProfile) => void;
  onCancel: () => void;
  excludeIds: string[];
}

export function AddParticipantByHandle({
  onAdd,
  onCancel,
  excludeIds,
}: AddParticipantByHandleProps) {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserProfile | null | "not_found">(null);

  async function search() {
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) return;

    setLoading(true);
    setResult(null);

    const supabase = createClient();
    const { data } = await supabase
      .rpc("lookup_user_by_handle", { p_handle: trimmed })
      .maybeSingle();

    setLoading(false);

    const profile = data as UserProfileRow | null;

    if (!profile) {
      setResult("not_found");
      return;
    }

    setResult({
      id: profile.id,
      handle: profile.handle,
      name: profile.name,
      avatarUrl: profile.avatar_url ?? undefined,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      search();
    }
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
              setResult(null);
            }}
            onKeyDown={handleKeyDown}
            className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Button
          type="button"
          size="icon"
          onClick={search}
          disabled={loading || !handle.trim()}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {loading && (
        <div className="mt-3">
          <ContactRowSkeleton />
        </div>
      )}

      {result === "not_found" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhum usuario encontrado com @{handle.trim().replace(/^@/, "")}
        </p>
      )}

      {result && result !== "not_found" && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <UserAvatar name={result.name} avatarUrl={result.avatarUrl} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{result.name}</p>
            <p className="text-xs text-muted-foreground">@{result.handle}</p>
          </div>
          {excludeIds.includes(result.id) ? (
            <span className="text-xs text-muted-foreground">Ja adicionado</span>
          ) : (
            <Button size="sm" onClick={() => onAdd(result as UserProfile)}>
              Adicionar
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
