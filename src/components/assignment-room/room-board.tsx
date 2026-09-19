"use client";

import { useMemo, useState } from "react";
import { RoomHostControls } from "@/components/assignment-room/room-host-controls";
import { RoomItemClaim } from "@/components/assignment-room/room-item-claim";
import { RoomShare } from "@/components/assignment-room/room-share";
import { ScreenHeader } from "@/components/shared/screen-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";

interface RoomBoardProps {
  view: AssignmentRoomView;
  connected: boolean;
  joinUrl: string | null;
  pendingItemIds: string[];
  claimError?: { itemId: string; message: string } | null;
  pendingParticipantIds?: string[];
  rotatingInvite?: boolean;
  closePending?: boolean;
  cancelPending?: boolean;
  onBack?: () => void;
  onClaim: (itemId: string, participantId: string, ticks: number) => void;
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
  pendingParticipantIds,
  rotatingInvite = false,
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
  const [hostParticipantId, setHostParticipantId] = useState(
    view.room.selfParticipantId || activeParticipants[0]?.id || "",
  );
  const selectedHostParticipantId = activeParticipants.some(
    (participant) => participant.id === hostParticipantId,
  )
    ? hostParticipantId
    : activeParticipants[0]?.id ?? "";
  const claimParticipantId =
    view.role === "host" ? selectedHostParticipantId : view.room.selfParticipantId;
  const claimParticipant = activeParticipants.find(
    (participant) => participant.id === claimParticipantId,
  );
  const itemRows = useMemo(
    () =>
      view.room.items.map((item) => {
        const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
        const totalClaimedTicks = view.room.claims
          .filter((claim) => claim.itemId === item.id)
          .reduce((sum, claim) => sum + claim.ticks, 0);
        const ownClaimedTicks = view.room.claims.find(
          (claim) =>
            claim.itemId === item.id && claim.participantId === claimParticipantId,
        )?.ticks ?? 0;
        return {
          item,
          ownClaimedTicks,
          availableTicks: Math.max(0, capacityTicks - totalClaimedTicks),
          complete: totalClaimedTicks === capacityTicks,
        };
      }),
    [claimParticipantId, view.room.claims, view.room.items],
  );
  const fullyAssignedCount = itemRows.filter((row) => row.complete).length;
  const roomComplete = fullyAssignedCount === itemRows.length && itemRows.length > 0;
  const self = view.room.participants.find(
    (participant) => participant.id === view.room.selfParticipantId,
  );
  const accessRemoved = view.role === "participant" && (!self || self.removed);
  const roomEditable =
    connected &&
    !accessRemoved &&
    (view.room.status === "open" || (view.role === "host" && view.room.status === "closed"));

  return (
    <div className="min-h-dvh bg-background pb-[max(2rem,env(safe-area-inset-bottom))]">
      <ScreenHeader
        title={view.room.title}
        eyebrow="Escolha de itens"
        back
        onBack={onBack}
      />
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-3">
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
            <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="room-people-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="room-people-heading" className="font-heading font-semibold">Na sala</h2>
                  <p className="text-sm text-muted-foreground">
                    {activeParticipants.length} {activeParticipants.length === 1 ? "pessoa" : "pessoas"}
                  </p>
                </div>
              </div>
              <ul className="flex flex-wrap gap-3">
                {activeParticipants.map((participant) => (
                  <li key={participant.id} className="flex items-center gap-2">
                    <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                    <span className="text-sm font-medium">{participant.displayName}</span>
                  </li>
                ))}
              </ul>
            </section>

            {view.role === "host" && (
              <div className="space-y-2">
                <label htmlFor="host-claim-participant" className="text-sm font-medium">
                  Editar escolhas de
                </label>
                <select
                  id="host-claim-participant"
                  value={selectedHostParticipantId}
                  className="min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
                  onChange={(event) => setHostParticipantId(event.target.value)}
                >
                  {activeParticipants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="order-1">
                <h2 className="font-heading text-lg font-semibold">Disponíveis</h2>
                <p className="text-sm text-muted-foreground">Itens que ainda têm quantidade livre.</p>
              </div>
              {itemRows.every(
                (row) =>
                  row.availableTicks === 0 ||
                  row.ownClaimedTicks > 0 ||
                  claimError?.itemId === row.item.id,
              ) && (
                <p className="order-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum outro item disponível agora.
                </p>
              )}
              <div className="order-3 mt-3">
                <h2 className="font-heading text-lg font-semibold">
                  {view.role === "host" && claimParticipant
                    ? `Parte de ${claimParticipant.displayName}`
                    : "Minha parte"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  As escolhas salvas continuam editáveis aqui.
                </p>
              </div>
              {itemRows.every((row) => row.ownClaimedTicks === 0) && (
                <p className="order-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum item escolhido ainda.
                </p>
              )}
              {itemRows.map((row) => {
                const assigned = row.ownClaimedTicks > 0;
                const rejected = claimError?.itemId === row.item.id;
                const visible = assigned || row.availableTicks > 0 || rejected;
                return (
                  <div
                    key={row.item.id}
                    data-assignment-section={assigned ? "assigned" : "available"}
                    className={`${assigned ? "order-4" : "order-2"} ${visible ? "" : "hidden"}`}
                  >
                    <RoomItemClaim
                      key={claimParticipantId}
                      item={row.item}
                      claimedTicks={row.ownClaimedTicks}
                      availableTicks={row.availableTicks}
                      pending={pendingItemIds.includes(row.item.id)}
                      disabled={!roomEditable || claimParticipantId.length === 0}
                      errorMessage={rejected ? claimError.message : null}
                      onSubmit={(ticks) => onClaim(row.item.id, claimParticipantId, ticks)}
                    />
                  </div>
                );
              })}
            </div>

            {view.role === "host" && (
              <>
                <RoomShare url={joinUrl} rotating={rotatingInvite} onRotate={onRotateInvite} />
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
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
