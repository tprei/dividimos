"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RoomBoard } from "@/components/assignment-room/room-board";
import { RoomBreakdown } from "@/components/assignment-room/room-breakdown";
import { RoomJoin, type RoomJoinIdentity } from "@/components/assignment-room/room-join";
import {
  buildAssignmentRoomFailureMessage,
  RoomReview,
  type RoomPayerDraft,
} from "@/components/assignment-room/room-review";
import { Button } from "@/components/ui/button";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import { buildAssignmentRoomUrl, readAssignmentRoomFragment } from "@/lib/assignment-room-qr";
import { allocateEvenly } from "@/lib/expense-money";
import { startAssignmentRoomRealtime } from "@/lib/sync/assignment-room-realtime";
import {
  acceptInvitation,
} from "@/lib/sync/mutations-group";
import {
  cancelAssignmentRoom,
  claimAssignmentRoomGuest,
  closeAssignmentRoom,
  finalizeAssignmentRoom,
  getAssignmentRoomJoinAccount,
  getAssignmentRoomJoinToken,
  getAssignmentRoomMemberToken,
  joinAssignmentRoom,
  refreshAssignmentRoom,
  refreshAssignmentRoomCompletion,
  removeAssignmentRoomParticipant,
  rotateAssignmentRoomJoin,
  setAssignmentRoomClaim,
} from "@/lib/sync/assignment-rooms";
import { attachAuthListener } from "@/lib/sync/auth";
import { getAuthGeneration } from "@/lib/sync/client";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import { useAssignmentRoomStore } from "@/stores/assignment-room-store";
import type {
  AssignmentRoomCompletion,
  AssignmentRoomView,
} from "@/types/assignment-room";
import type { ExpensePayerPayload } from "@/types/ledger";

interface RoomPageClientProps {
  roomId: string;
}

function activeRoomParticipants(view: Extract<AssignmentRoomView, { role: "host" }>) {
  return view.room.participants
    .map((participant, snapshotIndex) => ({ participant, snapshotIndex }))
    .filter(({ participant }) => !participant.removed)
    .sort((left, right) =>
      left.participant.ordinal === right.participant.ordinal
        ? left.snapshotIndex - right.snapshotIndex
        : left.participant.ordinal - right.participant.ordinal,
    );
}

function roomPayerPayload(
  view: Extract<AssignmentRoomView, { role: "host" }>,
  payers: RoomPayerDraft[],
): ExpensePayerPayload[] {
  const refByParticipantId = new Map(
    view.participantRefs.map((entry) => [entry.participantId, entry.ref]),
  );
  const participantIndexes = new Map<string, number>();
  let participantIndex = 0;
  for (const { participant } of activeRoomParticipants(view)) {
    const ref = refByParticipantId.get(participant.id);
    if (!participant.isGuest && ref?.kind === "user" && ref.userId.length > 0) {
      participantIndexes.set(ref.userId, participantIndex);
    }
    participantIndex += 1;
  }
  return payers.flatMap((payer) => {
    const index = participantIndexes.get(payer.userId);
    return index === undefined ? [] : [{ participantIndex: index, amountCents: payer.amountCents }];
  });
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
  const [payers, setPayers] = useState<RoomPayerDraft[]>([]);
  const [completion, setCompletion] = useState<AssignmentRoomCompletion | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [completionActionPending, setCompletionActionPending] = useState(false);
  const payerIdentityRef = useRef(`${roomId}:${accountId ?? ""}`);

  useEffect(() => {
    const identity = `${roomId}:${accountId ?? ""}`;
    if (payerIdentityRef.current === identity) return;
    payerIdentityRef.current = identity;
    setPayers([]);
  }, [accountId, roomId]);

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
    if (inviteRequestRef.current?.roomId !== roomId) {
      inviteRequestRef.current = {
        roomId,
        requested: new URLSearchParams(window.location.search).get("invite") === "1",
      };
    }
    if (inviteRequestRef.current.requested) setInviteOpen(true);
    const params = new URLSearchParams(window.location.search);
    const hadInviteParam = params.get("invite") !== null;
    params.delete("invite");
    const query = params.toString();
    if (window.location.hash || hadInviteParam) {
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
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
  useEffect(() => {
    if (!view || view.role !== "host") return;
    const refsByParticipantId = new Map(
      view.participantRefs.map((entry) => [entry.participantId, entry.ref]),
    );
    const eligibleIds = new Set(
      activeRoomParticipants(view).flatMap(({ participant }) => {
        const ref = refsByParticipantId.get(participant.id);
        return !participant.isGuest && ref?.kind === "user" && ref.userId.length > 0
          ? [ref.userId]
          : [];
      }),
    );
    setPayers((current) => {
      const next = current.filter(
        (payer) =>
          eligibleIds.has(payer.userId) &&
          Number.isSafeInteger(payer.amountCents) &&
          payer.amountCents > 0,
      );
      return next.length === current.length ? current : next;
    });
  }, [view]);
  useEffect(() => {
    if (view?.room.status !== "closed") {
      setEditingClosed(false);
    }
  }, [view?.room.status]);
  const wasGuestRef = useRef(false);

  useEffect(() => {
    if (view?.role === "participant") {
      wasGuestRef.current = true;
      return;
    }
    if (!view && wasGuestRef.current) {
      setPageError((current) => current ?? "Seu acesso foi removido.");
    }
  }, [view]);
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
    if (view?.room.status !== "finalized") {
      setCompletion(null);
      setCompletionPending(false);
      return;
    }
    let active = true;
    setCompletionPending(true);
    void refreshAssignmentRoomCompletion(roomId)
      .then((value) => {
        if (active) setCompletion(value);
      })
      .catch((error) => {
        if (active) setPageError(ledgerErrorMessage(error));
      })
      .finally(() => {
        if (active) setCompletionPending(false);
      });
    return () => {
      active = false;
    };
  }, [roomId, view?.room.status, view?.room.revision]);

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
    expectedItemRevision?: number,
  ): Promise<boolean> {
    if (!view || !entry?.connected) return false;
    const target = view.room.participants.find((participant) => participant.id === participantId);
    if (!target || target.removed) return false;
    if (
      (view.role === "participant" && (participantId !== view.room.selfParticipantId || view.room.status !== "open")) ||
      (view.role === "host" && view.room.status !== "open" && view.room.status !== "closed")
    ) {
      return false;
    }
    const item = view.room.items.find((candidate) => candidate.id === itemId);
    if (!item) return false;
    setClaimError(null);
    try {
      await setAssignmentRoomClaim({
        roomId,
        itemId,
        participantId,
        expectedItemRevision: expectedItemRevision ?? item.revision,
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
  function handleCreateBill() {
    const destination = "/app/bill/new";
    router.push(accountId ? destination : `/auth?next=${encodeURIComponent(destination)}`);
  }


  function handleSetPayerFull(userId: string) {
    if (!view || view.role !== "host") return;
    setPayers([{ userId, amountCents: view.room.totalCents }]);
  }

  function handleSplitPaymentEqually(userIds: string[]) {
    if (!view || userIds.length === 0) return;
    const amounts = allocateEvenly(view.room.totalCents, userIds.length);
    if (!amounts.ok) return;
    setPayers(
      userIds.map((userId, index) => ({ userId, amountCents: amounts.value[index] })),
    );
  }

  function handleSetPayerAmount(userId: string, amountCents: number) {
    setPayers((current) => {
      const rest = current.filter((payer) => payer.userId !== userId);
      return amountCents > 0 ? [...rest, { userId, amountCents }] : rest;
    });
  }

  function handleRemovePayerEntry(userId: string) {
    setPayers((current) => current.filter((payer) => payer.userId !== userId));
  }

  async function handleFinalize() {
    if (!view || view.role !== "host" || finalizePending) return;
    const payerPayload = roomPayerPayload(view, payers);
    const built = buildAssignmentExpense(view, payerPayload);
    if (!built.ok) {
      setPageError(buildAssignmentRoomFailureMessage(built.issue.code));
      return;
    }
    setFinalizePending(true);
    setPageError(null);
    try {
      await finalizeAssignmentRoom({
        roomId,
        expectedRevision: view.room.revision,
        payload: built.value,
      });
      setPayers([]);
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setFinalizePending(false);
    }
  }

  async function handleCompletionAction() {
    if (!completion || completionActionPending) return;
    const action = completion.action;
    if (action.kind === "unavailable") return;
    if (action.kind === "sign_in") {
      router.push(`/auth?next=${encodeURIComponent(`/room/${roomId}`)}`);
      return;
    }
    const authGeneration = getAuthGeneration();
    setCompletionActionPending(true);
    setPageError(null);
    try {
      if (action.kind === "claim_guest") {
        const ack = await claimAssignmentRoomGuest(roomId);
        if (getAuthGeneration() !== authGeneration) return;
        const updated = await refreshAssignmentRoomCompletion(roomId);
        if (getAuthGeneration() !== authGeneration) return;
        setCompletion(updated);
        router.push(`/app/bill/${ack.expenseId}`);
      } else if (action.kind === "accept_invitation") {
        await acceptInvitation(action.groupId);
        if (getAuthGeneration() !== authGeneration) return;
        router.push(`/app/bill/${action.expenseId}`);
      } else if (action.kind === "view_expense") {
        router.push(`/app/bill/${action.expenseId}`);
      }
    } catch (error) {
      setPageError(ledgerErrorMessage(error));
    } finally {
      setCompletionActionPending(false);
    }
  }


  if (!fragmentReady) return <RoomLoading />;

  if (inviteToken && !view) {
    return (
      <main className="min-h-full px-4 py-6 sm:px-6 sm:py-8">
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
          <Button type="button" className="min-h-11 w-full" onClick={handleCreateBill}>
            Criar outra sala
          </Button>
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => router.back()}>
            Voltar
          </Button>

        </section>
      </main>
    );
  }

  if (view.room.status === "finalized" && (completion?.bill ?? view.room.currentBill)) {
    const bill = completion?.bill ?? view.room.currentBill;
    if (!bill) return <RoomLoading />;
    const actionLabel =
      completion?.action.kind === "view_expense"
        ? "Ver conta"
        : completion?.action.kind === "accept_invitation"
          ? "Aceitar convite e ver conta"
          : completion?.action.kind === "claim_guest"
            ? "Vincular minha parte e ver conta"
            : completion?.action.kind === "sign_in"
              ? "Entrar com Google para vincular minha parte"
              : undefined;
    const hostFirstName = view.room.participants.find((participant) => participant.ordinal === 0)?.displayName.trim().split(/\s+/)[0];
    return (
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col">
        {pageError && <p role="alert" className="rounded-xl border p-3 text-sm text-destructive">{pageError}</p>}
        {completionPending && <p role="status" className="text-sm text-muted-foreground">Atualizando sua parte...</p>}
        <RoomBreakdown
          bill={bill}
          selfParticipantIndex={completion?.selfParticipantIndex ?? null}
          heading={view.role === "host" ? "Conta registrada" : hostFirstName ? `${hostFirstName} encerrou a sala` : "Sala encerrada"}
          actionLabel={actionLabel}
          actionDisabled={completionActionPending}
          onAction={completion ? handleCompletionAction : undefined}
        />
      </main>
    );
  }

  if (view.role === "host" && view.room.status === "closed" && !editingClosed) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col">
        {pageError && <p role="alert" className="rounded-xl border p-3 text-sm text-destructive">{pageError}</p>}
        <RoomReview
          view={view}
          pending={finalizePending}
          blockerMessage={
            !entry?.connected
              ? "Reconectando. Aguarde os dados atuais da sala."
              : entry.pendingItemIds.length > 0 || pendingParticipantIds.length > 0
                ? "Salvando uma alteração. Aguarde antes de registrar a conta."
                : null
          }
          payers={payers}
          onSetPayerFull={handleSetPayerFull}
          onSplitPaymentEqually={handleSplitPaymentEqually}
          onSetPayerAmount={handleSetPayerAmount}
          onRemovePayerEntry={handleRemovePayerEntry}
          onEditClaims={() => setEditingClosed(true)}
          onFinalize={handleFinalize}
        />
      </main>
    );
  }

  return (
    <>
      {pageError && <p role="alert" className="mx-auto mt-3 max-w-2xl rounded-xl border px-4 py-3 text-sm text-destructive">{pageError}</p>}
      <RoomBoard
        view={view}
        connected={entry?.connected ?? false}
        joinUrl={joinUrl}
        pendingItemIds={entry?.pendingItemIds ?? []}
        claimError={claimError}
        activity={entry?.latestActivity ?? null}
        pendingParticipantIds={pendingParticipantIds}
        rotatingInvite={rotatingInvite}
        inviteOpen={inviteOpen}
        onInviteOpenChange={setInviteOpen}
        inviteError={inviteError}
        closePending={closePending}
        cancelPending={cancelPending}
        onBack={editingClosed ? () => setEditingClosed(false) : () => router.back()}
        onReview={view.role === "host" && view.room.status === "closed" ? () => setEditingClosed(false) : undefined}
        onClaim={handleClaim}
        onRotateInvite={handleRotateInvite}
        onRemoveParticipant={handleRemoveParticipant}
        onClose={handleClose}
        onCancel={handleCancel}
        onCreateBill={handleCreateBill}
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
