"use client";

import { Loader2, MessageSquarePlus, Search, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMe } from "@/hooks/use-me";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { getOrCreateDm, lookupUserByHandle } from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";

type HandleSearchResult = UserProfile | "not_found" | null;

export function NewConversationButton() {
  const router = useRouter();
  const me = useMe();
  const groupOrder = useAppStore((s) => s.groupOrder);
  const groups = useAppStore((s) => s.groups);
  const [open, setOpen] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [searchResult, setSearchResult] = useState<HandleSearchResult>(null);
  const [searching, setSearching] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const { knownContacts, existingDmIds } = useMemo(() => {
    const contacts = new Map<string, UserProfile>();
    const dmIds = new Set<string>();
    if (me) {
      for (const groupId of groupOrder) {
        const snapshot = groups[groupId];
        if (!snapshot) continue;
        if (snapshot.group.kind === "dm") {
          const other = snapshot.members.find((m) => m.userId !== me.id);
          if (other) dmIds.add(other.userId);
          continue;
        }
        for (const member of snapshot.members) {
          if (member.userId === me.id || member.status !== "accepted") continue;
          if (!contacts.has(member.userId)) {
            contacts.set(member.userId, member.user);
          }
        }
      }
    }
    return { knownContacts: [...contacts.values()], existingDmIds: dmIds };
  }, [me, groupOrder, groups]);

  useEffect(() => {
    if (!open) return;
    setHandleInput("");
    setSearchResult(null);
  }, [open]);

  useEffect(() => {
    const trimmed = handleInput.trim().replace(/^@/, "");
    if (trimmed.length < 2 || !me) {
      setSearchResult(null);
      return;
    }

    let stale = false;
    clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      setSearching(true);
      setSearchResult(null);
      lookupUserByHandle(trimmed)
        .then((profile) => {
          if (stale) return;
          setSearchResult(!profile || profile.id === me.id ? "not_found" : profile);
        })
        .catch(() => {
          if (!stale) setSearchResult("not_found");
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, 500);

    return () => {
      stale = true;
      clearTimeout(debounceRef.current);
    };
  }, [handleInput, me]);

  const handleSelect = useCallback(
    async (userId: string) => {
      setCreatingId(userId);
      try {
        await getOrCreateDm(userId);
        setOpen(false);
        router.push(`/app/conversations/${userId}`);
      } catch (error) {
        toast.error(ledgerErrorMessage(error));
      } finally {
        setCreatingId(null);
      }
    },
    [router],
  );

  const hasExistingDm = useCallback(
    (userId: string) => existingDmIds.has(userId),
    [existingDmIds],
  );

  const showSearchSection = handleInput.trim().length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
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
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Search className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {showSearchSection && (
              <div className="mt-3">
                {searching && (
                  <p className="text-sm text-muted-foreground">Buscando...</p>
                )}
                {!searching && searchResult === "not_found" && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum usuário encontrado com @{handleInput.trim().replace(/^@/, "")}
                  </p>
                )}
                {!searching &&
                  searchResult &&
                  searchResult !== "not_found" && (
                    <button
                      type="button"
                      onClick={() => void handleSelect(searchResult.id)}
                      disabled={creatingId !== null}
                      className="flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                    >
                      <UserAvatar
                        name={searchResult.name}
                        avatarUrl={searchResult.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{searchResult.name}</p>
                        <p className="text-xs text-muted-foreground">@{searchResult.handle}</p>
                        {hasExistingDm(searchResult.id) ? (
                          <p className="text-xs text-muted-foreground">Conversa já existe</p>
                        ) : (
                          knownContacts.every((c) => c.id !== searchResult.id) && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <TriangleAlert className="h-3 w-3" />
                              Novo contato — será necessário confirmar o convite
                            </div>
                          )
                        )}
                      </div>
                      {creatingId === searchResult.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  )}
              </div>
            )}
          </div>

          {(knownContacts.length > 0) && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conhecidos
              </p>
              <div className="space-y-1">
                {knownContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => void handleSelect(contact.id)}
                    disabled={creatingId !== null}
                    className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                  >
                    <UserAvatar name={contact.name} avatarUrl={contact.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">@{contact.handle}</p>
                    </div>
                    {creatingId === contact.id && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {knownContacts.length === 0 && !showSearchSection && (
            <div className="mt-4 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Busque por @handle para iniciar uma conversa
              </p>
            </div>
          )}

          <div className="mt-4">
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
