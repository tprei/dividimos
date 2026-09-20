"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RoomBoard } from "@/components/assignment-room/room-board";
import { RoomBreakdown } from "@/components/assignment-room/room-breakdown";
import { RoomJoin, type RoomJoinIdentity } from "@/components/assignment-room/room-join";
import { RoomReview } from "@/components/assignment-room/room-review";
import { Button } from "@/components/ui/button";
import { buildAssignmentRoomUrl, readAssignmentRoomFragment } from "@/lib/assignment-room-qr";
import { startAssignmentRoomRealtime } from "@/lib/sync/assignment-room-realtime";
import {
  cancelAssignmentRoom,
  closeAssignmentRoom,
  finalizeAssignmentRoom,
  getAssignmentRoomJoinAccount,
  getAssignmentRoomJoinToken,
  getAssignmentRoomMemberToken,
  joinAssignmentRoom,
  refreshAssignmentRoom,
  removeAssignmentRoomParticipant,
  rotateAssignmentRoomJoin,
  setAssignmentRoomClaim,
} from "@/lib/sync/assignment-rooms";
import { attachAuthListener } from "@/lib/sync/auth";
import { getAuthGeneration } from "@/lib/sync/client";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import { useAssignmentRoomStore } from "@/stores/assignment-room-store";
import type { ExpensePayload } from "@/types/ledger";

interface RoomPageClientProps {
  roomId: string;
}

export function RoomPageClient({ roomId }: RoomPageClientProps) {
  const router = useRouter();
  const accountId = useAppStore((state) => state.me?.id ?? null);
  const accountName = useAppStore((state) => state.me?.name ?? null);
  const entry = useAssignmentRoomStore((state) => state.rooms[roomId]);
  const [fragmentReady, setFragmentReady] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const inviteFragmentRef = useRef<string | null | undefined>(undefined);
  const [joinPending, setJoinPending] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{
    itemId: string;
    participantId: string;
    message: string;
  } | null>(null);
  const [pendingParticipantIds, setPendingParticipantIds] = useState<string[]>([]);
  const [rotatingInvite, setRotatingInvite] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<RoomJoinIdentity>({ status: "loading" });
  const [identityRetry, setIdentityRetry] = useState(0);
  const inviteRequestRef = useRef<{ roomId: string; requested: boolean } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [finalizePending, setFinalizePending] = useState(false);
  const [editingClosed, setEditingClosed] = useState(false);

  useEffect(() => {
    const fragmentToken =
      inviteFragmentRef.current === undefined
        ? readAssignmentRoomFragment(roomId, window.location.hash)
        : inviteFragmentRef.current;
    inviteFragmentRef.current = fragmentToken;
    try {
      const memberToken = getAssignmentRoomMemberToken(roomId);
      const hostJoinToken = getAssignmentRoomJoinToken(roomId);
      if (fragmentToken && memberToken === null && hostJoinToken === null) {
        setInviteToken(fragmentToken);
      }
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    }
    // The nonsecret first-use flag is captured once per room, before any URL
    // cleanup rewrites history. Strict Mode's effect replay reads the same
    // latch instead of seeing the parameter already gone and closing the
    // dialog. It only requests initial presentation and never reaches an RPC.
    if (inviteRequestRef.current?.roomId !== roomId) {
      inviteRequestRef.current = {
        roomId,
        requested:
          new URLSearchParams(window.location.search).get("invite") === "1",
      };
    }
    if (inviteRequestRef.current.requested) {
      setInviteOpen(true);
    }
    const params = new URLSearchParams(window.location.search);
    const hadInviteParam = params.get("invite") !== null;
    params.delete("invite");
    const query = params.toString();
    if (window.location.hash || hadInviteParam) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    }
    setFragmentReady(true);
  }, [roomId]);

  useEffect(
    () =>
      attachAuthListener(
        () => setPageError("Sua sessão mudou. Abra o convite novamente para continuar."),
        (error) => setPageError(ledgerErrorMessage(error)),
      ),
    [],
  );

  useEffect(() => {
    if (!fragmentReady) return;
    let memberToken: string | null;
    try {
      memberToken = getAssignmentRoomMemberToken(roomId);
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
      return;
    }
    if (inviteToken && memberToken === null) return;
    let active = true;
    let stopRealtime: (() => void) | null = null;
    setPageError(null);
    void refreshAssignmentRoom(roomId)
      .then(() => {
        if (active) stopRealtime = startAssignmentRoomRealtime(roomId);
      })
      .catch((error) => {
        if (active) setPageError(ledgerErrorMessage(error));
      });
    return () => {
      active = false;
      stopRealtime?.();
    };
  }, [accountId, fragmentReady, inviteToken, roomId]);

  const view = entry?.view ?? null;
  const wasGuestRef = useRef(false);

  // Resolve the visitor's identity for the public join form only: with an
  // invite in hand and no room view yet. Disposal plus the auth generation
  // discard results that a sign-out/sign-in made stale. This is presentation
  // only — the join RPC still identifies the actor through `auth.uid()`.
  useEffect(() => {
    if (!fragmentReady || !inviteToken || view) return;
    setIdentity({ status: "loading" });
    let disposed = false;
    const generation = getAuthGeneration();
    getAssignmentRoomJoinAccount()
      .then((account) => {
        if (disposed || getAuthGeneration() !== generation) return;
        if (!account) {
          setIdentity({ status: "guest" });
          return;
        }
        // A cached `me` may supply a display name only while its id matches
        // the resolved account; otherwise render a generic account label.
        const name = accountId === account.id ? accountName : null;
        setIdentity({ status: "account", name });
      })
      .catch((error: unknown) => {
        if (disposed || getAuthGeneration() !== generation) return;
        setIdentity({ status: "error", message: ledgerErrorMessage(error) });
      });
    return () => {
      disposed = true;
    };
  }, [
    accountId,
    accountName,
    fragmentReady,
    identityRetry,
    inviteToken,
    roomId,
    view,
  ]);

  useEffect(() => {
    if (view?.role === "participant") {
      wasGuestRef.current = true;
      return;
    }
    if (!view && wasGuestRef.current) {
      setPageError((current) => current ?? "Seu acesso foi removido.");
    }
  }, [view]);

  let joinUrl: string | null = null;
  if (view?.role === "host") {
    try {
      const token = getAssignmentRoomJoinToken(roomId);
      joinUrl = token ? buildAssignmentRoomUrl(roomId, token) : null;
    } catch {
      joinUrl = null;
    }
  }

  async function handleJoin(displayName: string) {
    if (!inviteToken || joinPending) return;
    setJoinPending(true);
    setPageError(null);
    try {
      await joinAssignmentRoom({ roomId, joinToken: inviteToken, displayName });
      setInviteToken(null);
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setJoinPending(false);
    }
  }

  async function handleClaim(
    itemId: string,
    participantId: string,
    ticks: number,
  ): Promise<boolean> {
    if (!view || !entry?.connected) return false;
    const item = view.room.items.find((candidate) => candidate.id === itemId);
    if (!item) return false;
    setClaimError(null);
    try {
      await setAssignmentRoomClaim({
        roomId,
        itemId,
        participantId,
        expectedItemRevision: item.revision,
        ticks,
      });
      return true;
    } catch (error) {
      setClaimError({ itemId, participantId, message: ledgerErrorMessage(error) });
      return false;
    }
  }

  async function handleRotateInvite() {
    if (rotatingInvite) return;
    setRotatingInvite(true);
    setInviteError(null);
    try {
      await rotateAssignmentRoomJoin(roomId);
    } catch (error) {
      setInviteError(ledgerErrorMessage(error));
    } finally {
      setRotatingInvite(false);
    }
  }
  async function handleRemoveParticipant(participantId: string) {
    if (!view || pendingParticipantIds.includes(participantId)) return;
    setPendingParticipantIds((current) => [...current, participantId]);
    setPageError(null);
    try {
      await removeAssignmentRoomParticipant({
        roomId,
        participantId,
        expectedRevision: view.room.revision,
      });
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setPendingParticipantIds((current) => current.filter((id) => id !== participantId));
    }
  }
  async function handleClose() {
    if (!view || closePending) return;
    setClosePending(true);
    setPageError(null);
    try {
      await closeAssignmentRoom({ roomId, expectedRevision: view.room.revision });
      setEditingClosed(false);
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setClosePending(false);
    }
  }

  async function handleCancel() {
    if (!view || cancelPending) return;
    setCancelPending(true);
    setPageError(null);
    try {
      await cancelAssignmentRoom({ roomId, expectedRevision: view.room.revision });
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setCancelPending(false);
    }
  }

  async function handleFinalize(payload: ExpensePayload) {
    if (!view || finalizePending) return;
    setFinalizePending(true);
    setPageError(null);
    try {
      await finalizeAssignmentRoom({
        roomId,
        expectedRevision: view.room.revision,
        payload,
      });
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setFinalizePending(false);
    }
  }

  if (!fragmentReady) {
    return <RoomLoading />;
  }

  if (inviteToken && !view) {
    return (
      <main className="flex min-h-full items-center px-4 py-8">
        <RoomJoin
          identity={identity}
          onRetryIdentity={() => setIdentityRetry((current) => current + 1)}
          pending={joinPending}
          errorMessage={pageError}
          onJoin={handleJoin}
          onBack={() => router.back()}
        />
      </main>
    );
  }

  if (!view) {
    if (!pageError) return <RoomLoading />;
    return (
      <main className="flex min-h-full items-center justify-center px-4 py-8">
        <section className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-5 text-center">
          <h1 className="font-heading text-xl font-semibold">Convite inválido ou acesso expirado</h1>
          <p role="alert" className="text-sm text-muted-foreground">{pageError}</p>
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => router.back()}>
            Voltar
          </Button>
        </section>
      </main>
    );
  }

  if (view.room.status === "finalized" && view.room.currentBill) {
    return (
      <main className="mx-auto min-h-full w-full max-w-2xl space-y-4 px-4 py-6">
        <RoomBreakdown
          bill={view.room.currentBill}
          roomId={roomId}
          showLogin={view.role === "participant"}
        />
      </main>
    );
  }

  if (view.role === "host" && view.room.status === "closed" && !editingClosed) {
    return (
      <main className="mx-auto min-h-full w-full max-w-2xl space-y-4 px-4 py-6">
        {pageError && <p role="alert" className="rounded-xl border p-3 text-sm text-destructive">{pageError}</p>}
        <RoomReview
          view={view}
          pending={finalizePending}
          blockerMessage={entry?.connected ? null : "Reconectando. Aguarde os dados atuais da sala."}
          onEditClaims={() => setEditingClosed(true)}
          onFinalize={handleFinalize}
        />
      </main>
    );
  }

  return (
    <>
      {pageError && (
        <p role="alert" className="mx-auto mt-3 max-w-2xl rounded-xl border px-4 py-3 text-sm text-destructive">
          {pageError}
        </p>
      )}
      <RoomBoard
        view={view}
        connected={entry?.connected ?? false}
        joinUrl={joinUrl}
        pendingItemIds={entry?.pendingItemIds ?? []}
        claimError={claimError}
        pendingParticipantIds={pendingParticipantIds}
        rotatingInvite={rotatingInvite}
        inviteOpen={inviteOpen}
        onInviteOpenChange={setInviteOpen}
        inviteError={inviteError}
        closePending={closePending}
        cancelPending={cancelPending}
        onBack={editingClosed ? () => setEditingClosed(false) : () => router.back()}
        onClaim={handleClaim}
        onRotateInvite={handleRotateInvite}
        onRemoveParticipant={handleRemoveParticipant}
        onClose={handleClose}
        onCancel={handleCancel}
      />
    </>
  );
}

function RoomLoading() {
  return (
    <main className="flex min-h-full items-center justify-center px-4">
      <p role="status" className="text-sm text-muted-foreground">Carregando sala...</p>
    </main>
  );
}
