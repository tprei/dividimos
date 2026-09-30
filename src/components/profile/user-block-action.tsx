"use client";

import { useEffect, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserBlockConfirmation } from "@/components/profile/user-block-confirmation";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { blockUser, loadUserBlocks, unblockUser } from "@/lib/sync/user-blocks";
import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";

export function UserBlockAction({ target }: { target: UserProfile }) {
  const blocked = useAppStore((s) => s.blockedUsers.some((user) => user.id === target.id));
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    loadUserBlocks().then(
      () => {
        if (active) setLoaded(true);
      },
      (cause: unknown) => {
        if (active) setError(ledgerErrorMessage(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await (blocked ? unblockUser(target.id) : blockUser(target.id));
      setOpen(false);
    } catch (cause) {
      setError(ledgerErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        size="lg"
        className="min-h-11 w-full"
        disabled={!loaded}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Ban aria-hidden="true" />
        {blocked ? "Desbloquear pessoa" : "Bloquear pessoa"}
      </Button>
      {!loaded && error && (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
          <Button
            variant="ghost"
            className="min-h-11 shrink-0"
            onClick={() => {
              setError(null);
              setAttempt((current) => current + 1);
            }}
          >
            Tentar de novo
          </Button>
        </div>
      )}
      <UserBlockConfirmation
        open={open}
        anchor={trigger.current}
        target={target}
        action={blocked ? "unblock" : "block"}
        busy={busy}
        error={loaded ? error : null}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
