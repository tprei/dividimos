"use client";

import { ReceiptText } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RoomActivity } from "@/components/assignment-room/room-activity";
import { RoomHostControls } from "@/components/assignment-room/room-host-controls";
import { RoomItemClaim } from "@/components/assignment-room/room-item-claim";
import { RoomItemRow } from "@/components/assignment-room/room-item-row";
import { RoomShare } from "@/components/assignment-room/room-share";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import { cn } from "@/lib/utils";
import type {
  AssignmentRoomActivity,
  AssignmentRoomParticipant,
  AssignmentRoomView,
} from "@/types/assignment-room";

interface RoomBoardProps {
  view: AssignmentRoomView;
  connected: boolean;
  joinUrl: string | null;
  pendingItemIds: string[];
  claimError: { itemId: string; participantId: string; message: string } | null;
  activity?: AssignmentRoomActivity | null;
  pendingParticipantIds?: string[];
  rotatingInvite?: boolean;
  inviteOpen: boolean;
  onInviteOpenChange: (open: boolean) => void;
  inviteError: string | null;
  closePending?: boolean;
  cancelPending?: boolean;
  onBack?: () => void;
  onReview?: () => void;
  onClaim: (
    itemId: string,
    participantId: string,
    ticks: number,
    expectedItemRevision?: number,
  ) => Promise<boolean>;
  onRotateInvite: () => void;
  onRemoveParticipant: (participantId: string) => void;
  onClose: () => void;
  onCancel: () => void;
  onCreateBill: () => void;
}

export function RoomBoard({
  view,
  connected,
  joinUrl,
  pendingItemIds,
  claimError,
  activity = null,
  pendingParticipantIds = [],
  rotatingInvite = false,
  inviteOpen,
  onInviteOpenChange,
  inviteError,
  closePending = false,
  cancelPending = false,
  onBack,
  onReview,
  onClaim,
  onRotateInvite,
  onRemoveParticipant,
  onClose,
  onCancel,
  onCreateBill,
}: RoomBoardProps) {

  const activeParticipants = useMemo(
    () => view.room.participants.filter((participant) => !participant.removed),
    [view.room.participants],
  );
  const selfParticipantId = view.room.selfParticipantId;
  const participantById = useMemo(
    () => new Map(view.room.participants.map((participant) => [participant.id, participant])),
    [view.room.participants],
  );
  const itemRows = useMemo(() => {
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
          .filter((participant): participant is AssignmentRoomParticipant => Boolean(participant));
        return {
          item,
          claims: itemClaims,
          ownClaimedTicks,
          availableTicks: Math.max(0, capacityTicks - totalClaimedTicks),
          complete: totalClaimedTicks === capacityTicks,
          owners,
        };
      });
  }, [participantById, selfParticipantId, view.room.claims, view.room.items]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [targetParticipantId, setTargetParticipantId] = useState(selfParticipantId);
  const [assignmentParticipantId, setAssignmentParticipantId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const openTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hostHeadingRef = useRef<HTMLHeadingElement>(null);
  const availableHeadingRef = useRef<HTMLHeadingElement>(null);
  const personalHeadingRef = useRef<HTMLHeadingElement>(null);
  const personalListRef = useRef<HTMLUListElement>(null);

  const fullyAssignedCount = itemRows.filter((row) => row.complete).length;
  const roomComplete = fullyAssignedCount === itemRows.length && itemRows.length > 0;
  const self = view.room.participants.find((participant) => participant.id === selfParticipantId);
  const accessRemoved = view.role === "participant" && (!self || self.removed);
  const roomEditable =
    connected &&
    !accessRemoved &&
    (view.room.status === "open" || (view.role === "host" && view.room.status === "closed"));
  const hostControlsDisabled =
    !connected ||
    pendingItemIds.length > 0 ||
    pendingParticipantIds.length > 0 ||
    closePending ||
    cancelPending;
  const inviteVisible = view.role === "host" && view.room.status === "open";
  const availableRows = itemRows.filter((row) => row.availableTicks > 0);
  const mineRows = itemRows.filter((row) => row.ownClaimedTicks > 0);
  const selectedItem = selectedItemId
    ? itemRows.find((row) => row.item.id === selectedItemId) ?? null
    : null;
  const pickerParticipants = view.room.participants.filter((participant) => !participant.removed);
  const assignmentParticipant = assignmentParticipantId
    ? participantById.get(assignmentParticipantId) ?? null
    : null;

  function openItemEditor(itemId: string, trigger: HTMLButtonElement, participantId?: string) {
    openTriggerRef.current = trigger;
    setSelectedItemId(itemId);
    setTargetParticipantId(participantId ?? assignmentParticipantId ?? selfParticipantId);
    if (participantId) setAssignmentParticipantId(null);
    setEditorOpen(true);
  }

  function toggleDetails(itemId: string) {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

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
              latestActivity={activity}
              participants={view.room.participants}
              items={view.room.items}
              connected={connected}
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
          <section className="flex flex-col items-center rounded-3xl border bg-card px-5 py-10 text-center" aria-labelledby="room-cancelled-heading">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ReceiptText className="size-8" aria-hidden="true" />
            </div>
            <h2 id="room-cancelled-heading" className="mt-5 font-heading text-xl font-semibold">Sala cancelada</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Nenhuma conta foi registrada por esta sala. Você pode começar outra conta sem reaproveitar este convite.
            </p>
            <Button type="button" className="mt-6 min-h-11 w-full max-w-sm" onClick={onCreateBill}>
              Criar outra sala
            </Button>
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
            <p className="mt-1 text-sm text-muted-foreground">A divisão atual está disponível para consulta.</p>
          </section>
        )}

        {!accessRemoved && view.room.status !== "cancelled" && view.room.status !== "finalized" && (
          <>
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="room-progress-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p id="room-progress-heading" className="text-xs font-medium text-muted-foreground">Conta toda</p>
                  <Money cents={view.room.totalCents} className="mt-1 text-lg font-bold tabular-nums" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Você escolheu</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-primary-text">
                    {mineRows.length} {mineRows.length === 1 ? "linha" : "linhas"}
                  </p>
                </div>
              </div>
              {itemRows.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium">{fullyAssignedCount} de {itemRows.length} linhas escolhidas</span>
                    <span className="text-muted-foreground">{roomComplete ? "Tudo escolhido" : "Ainda falta gente escolher"}</span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Linhas totalmente escolhidas"
                    aria-valuemin={0}
                    aria-valuemax={itemRows.length}
                    aria-valuenow={fullyAssignedCount}
                  >
                    <div
                      className={roomComplete ? "h-full rounded-full bg-success transition-[width] duration-300" : "h-full rounded-full bg-primary transition-[width] duration-300"}
                      style={{ width: `${Math.round((fullyAssignedCount / itemRows.length) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-2" aria-labelledby="room-roster-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="room-roster-heading" className="font-heading text-lg font-semibold">Na sala</h2>
                <p className="text-xs text-muted-foreground">
                  {activeParticipants.length === 1 ? "1 pessoa na sala" : `${activeParticipants.length} pessoas na sala`}
                </p>
              </div>
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {activeParticipants.map((participant) => {
                  const selectable = view.role === "host";
                  const selected = assignmentParticipantId === participant.id;
                  return (
                    <li key={participant.id} aria-label={participant.displayName} className="shrink-0">
                      {selectable ? (
                        <button
                          type="button"
                          className={cn(
                            "flex min-h-11 items-center gap-1.5 rounded-full border bg-card py-1 pr-3 pl-1 text-left",
                            selected && "border-primary bg-primary/10",
                          )}
                          aria-pressed={selected}
                          disabled={!roomEditable}
                          onClick={() => setAssignmentParticipantId(selected ? null : participant.id)}
                        >
                          <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                          <span className="max-w-24 truncate text-xs font-medium">{participant.displayName.split(" ")[0]}</span>
                        </button>
                      ) : (
                        <span className="flex min-h-11 items-center gap-1.5 rounded-full border bg-card py-1 pr-3 pl-1">
                          <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                          <span className="max-w-24 truncate text-xs font-medium">{participant.displayName.split(" ")[0]}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {assignmentParticipant && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span>
                    Atribuindo itens para <strong>{assignmentParticipant.displayName}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 shrink-0 px-2 text-primary-text"
                    onClick={() => setAssignmentParticipantId(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </section>

            <RoomActivity
              activity={activity}
              participants={view.room.participants}
              items={view.room.items}
              connected={connected}
              live={!inviteOpen}
            />


            {itemRows.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Esta sala não tem itens.</p>
            ) : view.role === "host" ? (
              <section className="space-y-2" aria-labelledby="room-items-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="room-items-heading" ref={hostHeadingRef} tabIndex={-1} className="font-heading text-lg font-semibold">Itens</h2>
                  <p className="text-xs text-muted-foreground">{fullyAssignedCount} de {itemRows.length} completos</p>
                </div>
                <ul className="divide-y rounded-2xl border bg-card">
                  {itemRows.map((row) => (
                    <RoomItemRow
                      key={row.item.id}
                      item={row.item}
                      availableTicks={row.availableTicks}
                      ownTicks={row.ownClaimedTicks}
                      owners={row.owners}
                      claims={row.claims}
                      expanded={expandedItemIds.has(row.item.id)}
                      onToggleDetails={() => toggleDetails(row.item.id)}
                      pending={pendingItemIds.includes(row.item.id)}
                      disabled={!roomEditable}
                      mode="host"
                      onOpen={(trigger, participantId) => openItemEditor(row.item.id, trigger, participantId)}
                    />
                  ))}
                </ul>
              </section>
            ) : (
              <>
                {availableRows.length > 0 ? (
                  <section className="space-y-2" aria-labelledby="room-available-heading">
                    <h2 id="room-available-heading" ref={availableHeadingRef} tabIndex={-1} className="font-heading text-lg font-semibold">Disponíveis</h2>
                    <ul className="divide-y rounded-2xl border bg-card">
                      {availableRows.map((row) => (
                        <RoomItemRow
                          key={row.item.id}
                          item={row.item}
                          availableTicks={row.availableTicks}
                          ownTicks={row.ownClaimedTicks}
                          owners={row.owners}
                          claims={row.claims}
                          expanded={expandedItemIds.has(row.item.id)}
                          onToggleDetails={() => toggleDetails(row.item.id)}
                          pending={pendingItemIds.includes(row.item.id)}
                          disabled={!roomEditable}
                          mode="available"
                          onOpen={(trigger, participantId) => openItemEditor(row.item.id, trigger, participantId)}
                        />
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Todos os itens já foram escolhidos.</p>
                )}

                {mineRows.length > 0 ? (
                  <section className="space-y-2" aria-labelledby="room-mine-heading">
                    <h2 id="room-mine-heading" ref={personalHeadingRef} tabIndex={-1} className="font-heading text-lg font-semibold">Minha parte</h2>
                    <ul ref={personalListRef} className="divide-y rounded-2xl border bg-card">
                      {mineRows.map((row) => (
                        <RoomItemRow
                          key={row.item.id}
                          item={row.item}
                          availableTicks={row.availableTicks}
                          ownTicks={row.ownClaimedTicks}
                          owners={row.owners}
                          claims={row.claims}
                          expanded={expandedItemIds.has(row.item.id)}
                          onToggleDetails={() => toggleDetails(row.item.id)}
                          pending={pendingItemIds.includes(row.item.id)}
                          disabled={!roomEditable}
                          mode="mine"
                          onOpen={(trigger, participantId) => openItemEditor(row.item.id, trigger, participantId)}
                        />
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Você ainda não escolheu nenhum item.</p>
                )}
              </>
            )}

            {selectedItem && (
              <RoomItemClaim
                open={editorOpen}
                onOpenChange={setEditorOpen}
                getReturnFocus={getReturnFocus}
                item={selectedItem.item}
                claims={selectedItem.claims}
                availableTicks={selectedItem.availableTicks}
                targetParticipantId={targetParticipantId}
                participants={pickerParticipants}
                canSelectParticipant={view.role === "host"}
                onTargetChange={setTargetParticipantId}
                pending={pendingItemIds.includes(selectedItem.item.id)}
                disabled={!roomEditable}
                error={claimError && claimError.itemId === selectedItem.item.id ? { participantId: claimError.participantId, message: claimError.message } : null}
                onSubmit={(participantId, ticks, expectedItemRevision) =>
                  expectedItemRevision === undefined
                    ? onClaim(selectedItem.item.id, participantId, ticks)
                    : onClaim(selectedItem.item.id, participantId, ticks, expectedItemRevision)
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
                disabled={hostControlsDisabled}
                pendingParticipantIds={pendingParticipantIds}
                closePending={closePending}
                cancelPending={cancelPending}
                onRemove={onRemoveParticipant}
                onReturnToReview={onReview}
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
