"use client";

import { useMemo, useRef, useState } from "react";
import { RoomHostControls } from "@/components/assignment-room/room-host-controls";
import { RoomItemClaim } from "@/components/assignment-room/room-item-claim";
import { RoomItemRow } from "@/components/assignment-room/room-item-row";
import { RoomShare } from "@/components/assignment-room/room-share";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import type {
  AssignmentRoomParticipant,
  AssignmentRoomView,
} from "@/types/assignment-room";

interface RoomBoardProps {
  view: AssignmentRoomView;
  connected: boolean;
  joinUrl: string | null;
  pendingItemIds: string[];
  claimError: { itemId: string; participantId: string; message: string } | null;
  pendingParticipantIds?: string[];
  rotatingInvite?: boolean;
  inviteOpen: boolean;
  onInviteOpenChange: (open: boolean) => void;
  inviteError: string | null;
  closePending?: boolean;
  cancelPending?: boolean;
  onBack?: () => void;
  onClaim: (itemId: string, participantId: string, ticks: number) => Promise<boolean>;
  onRotateInvite: () => void;
  onRemoveParticipant: (participantId: string) => void;
  onClose: () => void;
  onCancel: () => void;
}

export function RoomBoard({
  view,
  connected,
  joinUrl,
  pendingItemIds,
  claimError,
  pendingParticipantIds = [],
  rotatingInvite = false,
  inviteOpen,
  onInviteOpenChange,
  inviteError,
  closePending = false,
  cancelPending = false,
  onBack,
  onClaim,
  onRotateInvite,
  onRemoveParticipant,
  onClose,
  onCancel,
}: RoomBoardProps) {
  const activeParticipants = useMemo(
    () => view.room.participants.filter((participant) => !participant.removed),
    [view.room.participants],
  );
  const selfParticipantId = view.room.selfParticipantId;
  const itemRows = useMemo(() => {
    const participantById = new Map(
      view.room.participants.map((participant) => [participant.id, participant]),
    );
    return [...view.room.items]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((item) => {
        const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
        const itemClaims = view.room.claims.filter((claim) => claim.itemId === item.id);
        const totalClaimedTicks = itemClaims.reduce((sum, claim) => sum + claim.ticks, 0);
        const ownClaimedTicks =
          itemClaims.find((claim) => claim.participantId === selfParticipantId)?.ticks ?? 0;
        const owners = itemClaims
          .filter((claim) => claim.ticks > 0)
          .map((claim) => participantById.get(claim.participantId))
          .filter((participant): participant is AssignmentRoomParticipant =>
            Boolean(participant),
          );
        return {
          item,
          ownClaimedTicks,
          availableTicks: Math.max(0, capacityTicks - totalClaimedTicks),
          complete: totalClaimedTicks === capacityTicks,
          owners,
        };
      });
  }, [selfParticipantId, view.room.claims, view.room.items, view.room.participants]);

  // Board-owned editor state: exactly one quantity dialog for the whole board,
  // kept mounted across close so focus restoration can finish. Opening a
  // different row replaces the remembered item.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const openTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hostHeadingRef = useRef<HTMLHeadingElement>(null);
  const availableHeadingRef = useRef<HTMLHeadingElement>(null);
  const personalHeadingRef = useRef<HTMLHeadingElement>(null);
  const personalListRef = useRef<HTMLUListElement>(null);

  const fullyAssignedCount = itemRows.filter((row) => row.complete).length;
  const roomComplete = fullyAssignedCount === itemRows.length && itemRows.length > 0;
  const self = view.room.participants.find(
    (participant) => participant.id === selfParticipantId,
  );
  const accessRemoved = view.role === "participant" && (!self || self.removed);
  const roomEditable =
    connected &&
    !accessRemoved &&
    (view.room.status === "open" || (view.role === "host" && view.room.status === "closed"));
  // The invitation is a host-only first-screen action and disappears with the
  // room lifecycle: closing, finalizing or cancelling removes it.
  const inviteVisible = view.role === "host" && view.room.status === "open";
  const availableRows = itemRows.filter((row) => row.availableTicks > 0);
  const mineRows = itemRows.filter((row) => row.ownClaimedTicks > 0);
  const selectedItem = selectedItemId
    ? itemRows.find((row) => row.item.id === selectedItemId) ?? null
    : null;

  function openItemEditor(itemId: string, trigger: HTMLButtonElement) {
    openTriggerRef.current = trigger;
    setSelectedItemId(itemId);
    setEditorOpen(true);
  }

  // Focus goes back to the row that opened the editor: the captured trigger
  // while it is still connected, then the same item's row inside the personal
  // section, then the relevant list heading.
  function getReturnFocus(): HTMLElement | null {
    if (openTriggerRef.current?.isConnected) return openTriggerRef.current;
    if (selectedItemId && personalListRef.current) {
      const rowButton = personalListRef.current.querySelector<HTMLButtonElement>(
        `[data-item-id="${CSS.escape(selectedItemId)}"] button`,
      );
      if (rowButton?.isConnected) return rowButton;
    }
    if (view.role === "host") return hostHeadingRef.current;
    if (selectedItemId && mineRows.some((row) => row.item.id === selectedItemId)) {
      return personalHeadingRef.current;
    }
    return availableHeadingRef.current;
  }

  return (
    <div className="min-h-full bg-background">
      <ScreenHeader
        title={view.room.title}
        eyebrow="Sala de divisão"
        back
        onBack={onBack}
        action={
          inviteVisible ? (
            <RoomShare
              url={joinUrl}
              open={inviteOpen}
              onOpenChange={onInviteOpenChange}
              rotating={rotatingInvite}
              rotationDisabled={!connected}
              errorMessage={inviteError}
              onRotate={onRotateInvite}
            />
          ) : undefined
        }
      />
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-3 pb-8">
        {!connected && !accessRemoved && view.room.status !== "cancelled" && (
          <p role="status" className="rounded-xl border bg-muted px-4 py-3 text-sm">
            Reconectando. As escolhas ficam bloqueadas até os dados atuais chegarem.
          </p>
        )}

        {accessRemoved && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-heading text-lg font-semibold">Seu acesso foi removido</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Suas escolhas foram liberadas. Peça um novo convite ao anfitrião se precisar voltar.
            </p>
          </section>
        )}

        {view.room.status === "cancelled" && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-heading text-lg font-semibold">Sala cancelada</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhuma conta foi registrada por esta sala.
            </p>
          </section>
        )}

        {view.room.status === "closed" && (
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-heading font-semibold">Aguardando confirmação</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {view.role === "host"
                ? "Revise as escolhas antes de registrar a conta. Você ainda pode corrigir quantidades."
                : "O anfitrião está revisando as escolhas. A conta ainda não foi registrada."}
            </p>
          </section>
        )}

        {view.room.status === "finalized" && (
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-heading font-semibold">Conta registrada</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A divisão atual está disponível para consulta.
            </p>
          </section>
        )}

        {!accessRemoved && view.room.status !== "cancelled" && view.room.status !== "finalized" && (
          <>
            <section
              className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-success/10 p-4 ring-1 ring-primary/15"
              aria-labelledby="room-roster-heading"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="room-roster-heading" className="text-sm font-semibold">
                  Na sala
                </h2>
                <p className="text-xs text-muted-foreground">
                  {activeParticipants.length === 1
                    ? "1 pessoa na sala"
                    : `${activeParticipants.length} pessoas na sala`}
                </p>
              </div>
              <ul className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
                {activeParticipants.map((participant) => (
                  <li
                    key={participant.id}
                    aria-label={participant.displayName}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-background/70 py-1 pr-3 pl-1"
                  >
                    <UserAvatar
                      name={participant.displayName}
                      avatarUrl={participant.avatarUrl}
                      size="sm"
                    />
                    <span className="max-w-24 truncate text-xs font-medium">
                      {participant.displayName.split(" ")[0]}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-background/70 px-3 py-2">
                <div>
                  <p className="text-[11px] text-muted-foreground">Conta toda</p>
                  <Money
                    cents={view.room.totalCents}
                    className="text-base font-bold tabular-nums"
                  />
                </div>
                {/* Only counts here: a live cent split would round differently
                    from the allocation the bill is finally built with. */}
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Você escolheu</p>
                  <p className="text-base font-bold tabular-nums text-primary-text">
                    {mineRows.length} {mineRows.length === 1 ? "linha" : "linhas"}
                  </p>
                </div>
              </div>

              {/* The bar answers the only question the room keeps asking:
                  how much of the receipt still has nobody's name on it. */}
              {itemRows.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium">
                      {fullyAssignedCount} de {itemRows.length} linhas escolhidas
                    </span>
                    <span className="text-muted-foreground">
                      {roomComplete ? "Tudo escolhido" : "Ainda falta gente escolher"}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10"
                    role="progressbar"
                    aria-label="Linhas totalmente escolhidas"
                    aria-valuemin={0}
                    aria-valuemax={itemRows.length}
                    aria-valuenow={fullyAssignedCount}
                  >
                    <div
                      className={
                        roomComplete
                          ? "h-full rounded-full bg-success transition-[width] duration-300"
                          : "h-full rounded-full bg-primary transition-[width] duration-300"
                      }
                      style={{
                        width: `${Math.round((fullyAssignedCount / itemRows.length) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </section>

            {itemRows.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Esta sala não tem itens.
              </p>
            ) : view.role === "host" ? (
              <section className="space-y-2" aria-labelledby="room-items-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h2
                    id="room-items-heading"
                    ref={hostHeadingRef}
                    tabIndex={-1}
                    className="font-heading text-lg font-semibold"
                  >
                    Itens
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {fullyAssignedCount} de {itemRows.length} completos
                  </p>
                </div>
                <ul className="divide-y rounded-2xl border bg-card">
                  {itemRows.map((row) => (
                    <RoomItemRow
                      key={row.item.id}
                      item={row.item}
                      availableTicks={row.availableTicks}
                      ownTicks={row.ownClaimedTicks}
                      owners={row.owners}
                      pending={pendingItemIds.includes(row.item.id)}
                      disabled={!roomEditable}
                      mode="host"
                      onOpen={(trigger) => openItemEditor(row.item.id, trigger)}
                    />
                  ))}
                </ul>
              </section>
            ) : (
              <>
                {availableRows.length > 0 ? (
                  <section className="space-y-2" aria-labelledby="room-available-heading">
                    <h2
                      id="room-available-heading"
                      ref={availableHeadingRef}
                      tabIndex={-1}
                      className="font-heading text-lg font-semibold"
                    >
                      Disponíveis
                    </h2>
                    <ul className="divide-y rounded-2xl border bg-card">
                      {availableRows.map((row) => (
                        <RoomItemRow
                          key={row.item.id}
                          item={row.item}
                          availableTicks={row.availableTicks}
                          ownTicks={row.ownClaimedTicks}
                          owners={row.owners}
                          pending={pendingItemIds.includes(row.item.id)}
                          disabled={!roomEditable}
                          mode="available"
                          onOpen={(trigger) => openItemEditor(row.item.id, trigger)}
                        />
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    Todos os itens já foram escolhidos.
                  </p>
                )}

                {mineRows.length > 0 ? (
                  <section className="space-y-2" aria-labelledby="room-mine-heading">
                    <h2
                      id="room-mine-heading"
                      ref={personalHeadingRef}
                      tabIndex={-1}
                      className="font-heading text-lg font-semibold"
                    >
                      Minha parte
                    </h2>
                    <ul
                      ref={personalListRef}
                      className="divide-y rounded-2xl border bg-card"
                    >
                      {mineRows.map((row) => (
                        <RoomItemRow
                          key={row.item.id}
                          item={row.item}
                          availableTicks={row.availableTicks}
                          ownTicks={row.ownClaimedTicks}
                          owners={row.owners}
                          pending={pendingItemIds.includes(row.item.id)}
                          disabled={!roomEditable}
                          mode="mine"
                          onOpen={(trigger) => openItemEditor(row.item.id, trigger)}
                        />
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    Você ainda não escolheu nenhum item.
                  </p>
                )}
              </>
            )}

            {selectedItem && (
              <RoomItemClaim
                open={editorOpen}
                onOpenChange={setEditorOpen}
                getReturnFocus={getReturnFocus}
                item={selectedItem.item}
                claims={view.room.claims.filter(
                  (claim) => claim.itemId === selectedItem.item.id,
                )}
                availableTicks={selectedItem.availableTicks}
                selfParticipantId={selfParticipantId}
                pending={pendingItemIds.includes(selectedItem.item.id)}
                disabled={!roomEditable}
                error={
                  claimError && claimError.itemId === selectedItem.item.id
                    ? { participantId: claimError.participantId, message: claimError.message }
                    : null
                }
                onSubmit={(participantId, ticks) =>
                  onClaim(selectedItem.item.id, participantId, ticks)
                }
              />
            )}

            {view.role === "host" && (
              <RoomHostControls
                participants={view.room.participants}
                fullyAssignedCount={fullyAssignedCount}
                totalItemCount={itemRows.length}
                complete={roomComplete}
                closed={view.room.status === "closed"}
                pendingParticipantIds={pendingParticipantIds}
                closePending={closePending}
                cancelPending={cancelPending}
                onRemove={onRemoveParticipant}
                onClose={onClose}
                onCancel={onCancel}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
