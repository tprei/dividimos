"use client";

import { motion } from "framer-motion";
import { Search, UserPlus, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  inviteMember,
  lookupUserByHandle,
} from "@/lib/sync/mutations-group";
import type { GroupMember, UserProfile } from "@/types/ledger";

interface InviteByHandlePanelProps {
  groupId: string;
  members: GroupMember[];
  onClose: () => void;
  onInvited: () => void;
}

export function InviteByHandlePanel({ groupId, members, onClose, onInvited }: InviteByHandlePanelProps) {
  const [handleInput, setHandleInput] = useState("");
  const [lookupResult, setLookupResult] = useState<UserProfile | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(false);

  const handleLookup = async () => {
    const handle = handleInput.toLowerCase().replace(/^@/, "").trim();
    if (!handle || searching) return;

    setSearching(true);
    setLookupResult(null);
    setLookupError("");

    try {
      const profile = await lookupUserByHandle(handle);
      if (!profile) {
        setLookupError(`Nenhum usuário encontrado com @${handle}`);
      } else if (members.some((m) => m.userId === profile.id)) {
        setLookupError("Já tá no grupo");
      } else {
        setLookupResult(profile);
      }
    } catch (e) {
      setLookupError(ledgerErrorMessage(e));
    } finally {
      setSearching(false);
    }
  };

  const handleInvite = async () => {
    if (!lookupResult || inviting) return;
    setInviting(true);
    try {
      await inviteMember(groupId, lookupResult.id);
      toast.success(`Convite enviado para @${lookupResult.handle}`);
      onInvited();
    } catch (e) {
      toast.error(ledgerErrorMessage(e));
    } finally {
      setInviting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">Convidar por @handle</span>
        <button
          onClick={() => {
            onClose();
            setLookupResult(null);
            setLookupError("");
          }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            @
          </span>
          <Input
            className="pl-7"
            placeholder="handle do usuario"
            value={handleInput}
            onChange={(e) => {
              setHandleInput(e.target.value.replace(/ /g, "."));
              setLookupResult(null);
              setLookupError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleLookup}
          disabled={!handleInput.trim() || searching}
          aria-label="Buscar handle"
          className="shrink-0"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {lookupError && (
        <p className="mt-2 text-xs text-destructive">{lookupError}</p>
      )}

      {lookupResult && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="lookup-result"
          className="mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3"
        >
          <UserAvatar
            name={lookupResult.name}
            avatarUrl={lookupResult.avatarUrl}
            size="sm"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">{lookupResult.name}</p>
            <p className="text-xs text-muted-foreground">
              @{lookupResult.handle}
            </p>
          </div>
          <Button size="sm" className="gap-1" onClick={handleInvite} disabled={inviting}>
            <UserPlus className="h-3.5 w-3.5" />
            Convidar
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
