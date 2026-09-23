"use client";

import { AnimatePresence } from "framer-motion";
import { ReceiptText } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RoomActivity } from "@/components/assignment-room/room-activity";
import { RoomHostControls, RoomHostMenu, RoomHostPerson } from "@/components/assignment-room/room-host-controls";
import { RoomItemClaim } from "@/components/assignment-room/room-item-claim";
import { RoomItemRow } from "@/components/assignment-room/room-item-row";
import { RoomShare } from "@/components/assignment-room/room-share";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import { previewClaimCents, projectAssignmentRoomMoney } from "@/lib/assignment-room-projection";
import { cn } from "@/lib/utils";
import type {
  AssignmentRoomActivity,
  AssignmentRoomItem,
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

  const projection = projectAssignmentRoomMoney(view.room);
  const roomMoney = projection?.ok ? projection.value : null;
  const selfMoney = roomMoney?.byParticipant[view.room.selfParticipantId] ?? null;
  const rowMoney = (item: AssignmentRoomItem) =>
    roomMoney
      ? {
          lineCents: item.totalPriceCents,
          unitCents: item.unitPriceCents,
          ownCents:
            roomMoney.byItem[item.id]?.claims.find(
              (claim) => claim.participantId === view.room.selfParticipantId,
            )?.amountCents ?? 0,
        }
      : undefined;
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
        const itemClaims = view.room.claims.filter((claim) =>
          claim.itemId === item.id && participantById.get(claim.participantId)?.removed === false,
        );
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

  function openItemEditor(itemId: string, trigger: HTMLButtonElement, participantId?: string) {
    openTriggerRef.current = trigger;
    setSelectedItemId(itemId);
    setTargetParticipantId(participantId ?? selfParticipantId);
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
    <div className="flex min-h-full flex-col bg-background [&>header]:mx-auto [&>header]:w-full [&>header]:max-w-lg [&>header_h1]:whitespace-normal">
      <ScreenHeader
        title={view.role === "host" ? view.room.title : "O que você consumiu?"}
        subtitle={view.role === "host" ? `Sala ${view.room.status === "open" ? "aberta" : "fechada"} · ${activeParticipants.length} na sala` : `${view.room.title} · ${activeParticipants.length} na sala`}
        back={view.role === "host"}
        onBack={onBack}
        action={
          inviteVisible ? (
            <div className="flex items-center">
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
            <RoomHostMenu disabled={hostControlsDisabled} onCancel={onCancel} />
            </div>
          ) : undefined
        }
      />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-5 px-4 pt-1 pb-8">
        {!connected && !accessRemoved && view.room.status !== "cancelled" && (
          <p role="status" className="rounded-xl border bg-muted px-4 py-3 text-sm">
            {view.role === "host" ? "Reconectando..." : "Reconectando…"}
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


        {view.room.status === "finalized" && (
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-heading font-semibold">Conta registrada</h2>
            <p className="mt-1 text-sm text-muted-foreground">A divisão atual está disponível para consulta.</p>
          </section>
        )}

        {!accessRemoved && view.room.status !== "cancelled" && view.room.status !== "finalized" && (
          <>
            {view.role === "host" && (roomMoney ? (
              <section className="rounded-2xl border bg-card p-4" aria-label="Progresso da divisão">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium"><Money cents={roomMoney.claimedItemsCents} /> de <Money cents={roomMoney.itemsSubtotalCents} /> com dono</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 }).format(roomMoney.itemsSubtotalCents > 0 ? roomMoney.claimedItemsCents / roomMoney.itemsSubtotalCents : 0)}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Valor com dono" aria-valuemin={0} aria-valuemax={roomMoney.itemsSubtotalCents} aria-valuenow={roomMoney.claimedItemsCents}>
                  <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300" style={{ width: new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(roomMoney.itemsSubtotalCents > 0 ? roomMoney.claimedItemsCents / roomMoney.itemsSubtotalCents : 0) }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{roomMoney.unownedLineCount > 0 ? <>{roomMoney.unownedLineCount} itens sem dono · <Money cents={roomMoney.unclaimedItemsCents} /></> : "Tudo com dono"}</p>
              </section>
            ) : <p role="alert" className="text-sm text-destructive">Não foi possível calcular a divisão.</p>)}

            <section className={view.role === "host" ? "space-y-2" : "sr-only"} aria-labelledby="room-roster-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="room-roster-heading" className="text-sm font-semibold">Na sala</h2>
                <p className="text-xs text-muted-foreground">
                  {view.role === "host" ? "toque pra gerenciar" : activeParticipants.length === 1 ? "1 pessoa na sala" : `${activeParticipants.length} pessoas na sala`}
                </p>
              </div>
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {activeParticipants.map((participant) => {
                  const selectable = view.role === "host";
                  return (
                    <li key={participant.id} aria-label={selectable ? undefined : participant.displayName} className="shrink-0">
                      {selectable ? (
                        <RoomHostPerson participant={participant} money={roomMoney?.byParticipant[participant.id]} disabled={hostControlsDisabled} removable={view.room.status === "open"} onRemove={onRemoveParticipant} />
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
            </section>

            {view.role === "participant" && (view.room.status === "closed" ? (
              <p role="status" className="flex min-h-11 items-center rounded-xl bg-muted px-3 text-sm text-muted-foreground">Aguardando confirmação</p>
            ) : (
              <RoomActivity
                activity={activity}
                participants={view.room.participants}
                items={view.room.items}
                connected={connected}
                live={!inviteOpen}
                variant="ticker"
              />
            ))}


            {view.role === "host" ? (
              <section className="space-y-2" aria-labelledby="room-items-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="room-items-heading" ref={hostHeadingRef} tabIndex={-1} className="text-sm font-semibold">Itens</h2>
                  <p className="text-xs text-muted-foreground">{roomMoney?.unownedLineCount ?? availableRows.length} sem dono</p>
                </div>
                <ul className={cn("overflow-hidden divide-y rounded-2xl bg-card", itemRows.length > 0 && "border")}>
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
                      money={rowMoney(row.item)}
                      claimMoney={roomMoney?.byItem[row.item.id]?.claims}
                      selfParticipantId={selfParticipantId}
                      onUndoParticipant={(participantId) => { void onClaim(row.item.id, participantId, 0, row.item.revision); }}
                      onOpen={(trigger, participantId) => openItemEditor(row.item.id, trigger, participantId)}
                    />
                  ))}
                </ul>
                {itemRows.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Esta sala não tem itens.</p>}
              </section>
            ) : (
              <>
                <section className="space-y-2" aria-labelledby="room-available-heading">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="room-available-heading" ref={availableHeadingRef} tabIndex={-1} className="text-sm font-semibold">Ainda sem dono</h2>
                    <span className="text-xs text-muted-foreground">{availableRows.length} itens</span>
                  </div>
                  <ul className={cn("overflow-hidden divide-y rounded-2xl bg-card", availableRows.length > 0 && "border")}>
                    <AnimatePresence initial={false}>
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
                          money={rowMoney(row.item)}
                          onOpen={(trigger) => openItemEditor(row.item.id, trigger)}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                  {availableRows.length === 0 && <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Tudo com dono</p>}
                </section>

                <section className="space-y-2" aria-labelledby="room-mine-heading">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="room-mine-heading" ref={personalHeadingRef} tabIndex={-1} className="text-sm font-semibold">Minha parte</h2>
                    {selfMoney && <Money cents={selfMoney.itemsCents} className="text-sm font-semibold tabular-nums" />}
                  </div>
                  <ul ref={personalListRef} className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
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
                        money={rowMoney(row.item)}
                        onUndo={() => { void onClaim(row.item.id, selfParticipantId, 0, row.item.revision); }}
                        onOpen={(trigger) => openItemEditor(row.item.id, trigger)}
                      />
                    ))}
                    {mineRows.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Toque em um item acima pra marcar.</li>}
                    {selfMoney && selfMoney.serviceFeeCents > 0 && (
                      <li className="flex min-h-11 items-center justify-between gap-3 border-t border-dashed px-4 py-2 text-xs text-muted-foreground">
                        <span>+ taxa de serviço {new Intl.NumberFormat("pt-BR").format(view.room.serviceFeeBasisPoints / 100)}%</span>
                        <Money cents={selfMoney.serviceFeeCents} className="tabular-nums" />
                      </li>
                    )}
                  </ul>
                  {claimError && !editorOpen && <p role="alert" className="text-sm text-destructive">{claimError.message}</p>}
                </section>
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
                previewCents={(participantId, ticks) => {
                  const preview = previewClaimCents(
                    view.room,
                    selectedItem.item.id,
                    participantId,
                    ticks,
                  );
                  return preview.ok ? preview.value : null;
                }}
                onSubmit={(participantId, ticks, expectedItemRevision) =>
                  expectedItemRevision === undefined
                    ? onClaim(selectedItem.item.id, participantId, ticks)
                    : onClaim(selectedItem.item.id, participantId, ticks, expectedItemRevision)
                }
              />
            )}

            {view.role === "host" && claimError && !editorOpen && <p role="alert" className="text-sm text-destructive">{claimError.message}</p>}
          </>
        )}
      </main>
      {view.role === "host" && (view.room.status === "open" || view.room.status === "closed") && (
        <RoomHostControls unownedLineCount={roomMoney?.unownedLineCount ?? availableRows.length} complete={Boolean(roomMoney) && roomComplete} closed={view.room.status === "closed"} disabled={hostControlsDisabled} closePending={closePending} onReturnToReview={onReview} onClose={onClose} />
      )}
      {view.role === "participant" && !accessRemoved && (view.room.status === "open" || view.room.status === "closed") && (
        <footer className="sticky bottom-0 z-10 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Sua parte</p>
              {selfMoney && <Money cents={selfMoney.withFeeCents} className="text-xl font-bold tabular-nums" />}
            </div>
            <p className="text-xs text-muted-foreground">{availableRows.length > 0 ? `${availableRows.length} sem dono` : "Tudo com dono"}</p>
          </div>
        </footer>
      )}
    </div>
  );
}
