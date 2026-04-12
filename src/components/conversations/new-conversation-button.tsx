"use client";

import { Loader2, MessageSquarePlus, Search, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/shared/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/use-auth";
import type { UserProfile } from "@/types";
import type { Database } from "@/types/database";

type UserProfileRow = Database["public"]["Views"]["user_profiles"]["Row"];

interface KnownContact {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
}

function rowToProfile(row: UserProfileRow): KnownContact {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

export function NewConversationButton() {
  const router = useRouter();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [knownContacts, setKnownContacts] = useState<KnownContact[]>([]);
  const [knownContactIds, setKnownContactIds] = useState<Set<string>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [searchResult, setSearchResult] = useState<UserProfile | null | "not_found">(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadKnownContacts = useCallback(async () => {
    if (!user) return;
    setLoadingContacts(true);

    const supabase = createClient();

    const { data: dmPairs } = await supabase
      .from("dm_pairs")
      .select("user_a, user_b")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

    const existingDmIds = new Set<string>(
      (dmPairs ?? []).map((p) =>
        p.user_a === user.id ? p.user_b : p.user_a,
      ),
    );

    const { data: memberRows } = await supabase
      .from("group_members")
      .select("group_id, user_id")
      .eq("user_id", user.id)
      .eq("status", "accepted");

    const myGroupIds = (memberRows ?? []).map((r) => r.group_id);

    if (myGroupIds.length === 0) {
      setKnownContacts([]);
      setKnownContactIds(existingDmIds);
      setLoadingContacts(false);
      return;
    }

    const { data: otherMembers } = await supabase
      .from("group_members")
      .select("user_id")
      .in("group_id", myGroupIds)
      .eq("status", "accepted")
      .neq("user_id", user.id);

    const otherIds = [...new Set((otherMembers ?? []).map((m) => m.user_id))];

    if (otherIds.length === 0) {
      setKnownContacts([]);
      setKnownContactIds(existingDmIds);
      setLoadingContacts(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("*")
      .in("id", otherIds);

    const contacts = (profiles ?? [])
      .map((p) => rowToProfile(p as UserProfileRow))
      .filter((c) => !existingDmIds.has(c.id));

    setKnownContacts(contacts);
    setKnownContactIds(existingDmIds);
    setLoadingContacts(false);
  }, [user]);

  useEffect(() => {
    if (open) {
      setHandleInput("");
      setSearchResult(null);
      loadKnownContacts();
    }
  }, [open, loadKnownContacts]);

  useEffect(() => {
    const trimmed = handleInput.trim().replace(/^@/, "");

    if (trimmed.length < 2) {
      setSearchResult(null);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchResult(null);

      const supabase = createClient();
      const { data } = await supabase
        .rpc("lookup_user_by_handle", { p_handle: trimmed })
        .maybeSingle();

      setSearching(false);

      const profile = data as UserProfileRow | null;

      if (!profile || profile.id === user?.id) {
        setSearchResult("not_found");
        return;
      }

      setSearchResult({
        id: profile.id,
        handle: profile.handle,
        name: profile.name,
        avatarUrl: profile.avatar_url ?? undefined,
      });
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [handleInput, user]);

  const handleSelect = useCallback((userId: string) => {
    setOpen(false);
    router.push(`/app/conversations/${userId}`);
  }, [router]);

  const hasExistingDm = (userId: string) => knownContactIds.has(userId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
        aria-label="Nova conversa"
      >
        <MessageSquarePlus className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova conversa</DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5">
              <span className="text-sm text-muted-foreground">@</span>
              <input
                autoFocus
                placeholder="buscar por handle"
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value.replace(/ /g, "."))}
                className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {!searching && <Search className="h-4 w-4 text-muted-foreground" />}
            </div>

            {handleInput.trim().length >= 2 && (
              <div className="mt-3">
                {searching && (
                  <p className="text-sm text-muted-foreground">Buscando...</p>
                )}
                {!searching && searchResult === "not_found" && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum usuário encontrado com @{handleInput.trim().replace(/^@/, "")}
                  </p>
                )}
                {!searching && searchResult && searchResult !== "not_found" && (
                  <button
                    type="button"
                    onClick={() => handleSelect(searchResult.id)}
                    disabled={hasExistingDm(searchResult.id)}
                    className="flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                  >
                    <UserAvatar name={searchResult.name} avatarUrl={searchResult.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{searchResult.name}</p>
                      <p className="text-xs text-muted-foreground">@{searchResult.handle}</p>
                      {!hasExistingDm(searchResult.id) && knownContacts.every((c) => c.id !== searchResult.id) && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <TriangleAlert className="h-3 w-3" />
                          Novo contato — será necessário confirmar o convite
                        </div>
                      )}
                      {hasExistingDm(searchResult.id) && (
                        <p className="text-xs text-muted-foreground">Conversa já existe</p>
                      )}
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {knownContacts.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conhecidos
              </p>
              <div className="space-y-1">
                {loadingContacts ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Carregando...</span>
                  </div>
                ) : (
                  knownContacts.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => handleSelect(contact.id)}
                      className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/50"
                    >
                      <UserAvatar name={contact.name} avatarUrl={contact.avatarUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">@{contact.handle}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {!loadingContacts && knownContacts.length === 0 && handleInput.trim().length < 2 && (
            <div className="mt-4 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Busque por @handle para iniciar uma conversa
              </p>
            </div>
          )}

          <div className="mt-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
