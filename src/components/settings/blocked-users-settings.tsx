"use client";

import { useState } from "react";
import { BlockedUsersSection, type BlockedUsersSectionProps } from "@/components/settings/blocked-users-section";
import { UserBlockConfirmation } from "@/components/profile/user-block-confirmation";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { loadUserBlocks, unblockUser } from "@/lib/sync/user-blocks";
import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";

export function BlockedUsersSettings() {
  const users = useAppStore((s) => s.blockedUsers);
  const bootstrapStatus = useAppStore((s) => s.bootstrapStatus);
  const [retry, setRetry] = useState<{ status: "loading" | "error" | "ready"; error: string | null } | null>(null);
  const [target, setTarget] = useState<{ user: UserProfile; anchor: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let status: BlockedUsersSectionProps["status"] = "loading";
  if (retry !== null) status = retry.status;
  else if (bootstrapStatus === "ready") status = "ready";
  else if (bootstrapStatus === "error") status = "error";

  async function reload() {
    setRetry({ status: "loading", error: null });
    try {
      await loadUserBlocks();
      setRetry({ status: "ready", error: null });
    } catch (cause) {
      setRetry({ status: "error", error: ledgerErrorMessage(cause) });
    }
  }

  async function confirmUnblock() {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await unblockUser(target.user.id);
      setTarget(null);
    } catch (cause) {
      setError(ledgerErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BlockedUsersSection
        users={users}
        status={status}
        error={retry?.error ?? null}
        busyUserId={busy && target !== null ? target.user.id : null}
        onRetry={() => void reload()}
        onUnblock={(user, anchor) => {
          setError(null);
          setTarget({ user, anchor });
        }}
      />
      {target !== null && (
        <UserBlockConfirmation
          open
          anchor={target.anchor}
          target={target.user}
          action="unblock"
          busy={busy}
          error={error}
          onCancel={() => setTarget(null)}
          onConfirm={() => void confirmUnblock()}
        />
      )}
    </>
  );
}
