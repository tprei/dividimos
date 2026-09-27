import {
  ROOM_TICKS_PER_MILLIUNIT,
  allocateAssignmentItemCents,
} from "@/lib/assignment-room-money";
import {
  MAX_EXPENSE_CENTS,
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
  type ValidationResult,
} from "@/lib/expense-money";
import type {
  AssignmentRoomItem,
  AssignmentRoomSnapshot,
  AssignmentItemShare,
} from "@/types/assignment-room";

export interface RoomParticipantMoney {
  itemsCents: number;
  withFeeCents: number;
  serviceFeeCents: number;
  fixedFeeCents: number;
  lineCount: number;
}

export interface RoomItemMoney {
  claims: { participantId: string; ticks: number; amountCents: number }[];
  remainingTicks: number;
  unclaimedCents: number;
}

export interface RoomMoneyProjection {
  itemsSubtotalCents: number;
  claimedItemsCents: number;
  unclaimedItemsCents: number;
  unownedLineCount: number;
  totalCents: number;
  serviceFeeBasisPoints: number;
  byParticipant: Record<string, RoomParticipantMoney>;
  byItem: Record<string, RoomItemMoney>;
}

interface LineClaim {
  participantId: string;
  ordinal: number;
  ticks: number;
}

// Sorts after every real participant, so real claims keep the same
// largest-remainder order the final division gives them.
const UNCLAIMED_ORDINAL = Number.MAX_SAFE_INTEGER;
const UNCLAIMED_ID = "\u0000unclaimed";

function capacityTicks(item: AssignmentRoomItem): number {
  return item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
}

/**
 * Splits one line's cents over its claims plus a virtual claim holding the
 * unowned remainder, so a partial claim owns only its share of the line.
 */
function allocateLine(
  item: AssignmentRoomItem,
  claims: readonly LineClaim[],
): ValidationResult<{ remainingTicks: number; owned: Map<string, number>; unclaimedCents: number }> {
  const claimedTicks = claims.reduce((sum, claim) => sum + claim.ticks, 0);
  const remainingTicks = capacityTicks(item) - claimedTicks;
  if (remainingTicks < 0) {
    return { ok: false, issue: { code: "allocation_exceeds_total", kind: "combined_shares" } };
  }
  const weighted =
    remainingTicks > 0
      ? [...claims, { participantId: UNCLAIMED_ID, ordinal: UNCLAIMED_ORDINAL, ticks: remainingTicks }]
      : claims;
  const allocated = allocateAssignmentItemCents(item.totalPriceCents, weighted);
  if (!allocated.ok) return allocated;
  const owned = new Map<string, number>();
  let unclaimedCents = 0;
  for (const row of allocated.value) {
    if (row.participantId === UNCLAIMED_ID) unclaimedCents = row.amountCents;
    else owned.set(row.participantId, row.amountCents);
  }
  return { ok: true, value: { remainingTicks, owned, unclaimedCents } };
}

/** Money an open or closed room would split right now, by line and by person. */
export function projectAssignmentRoomMoney(
  room: AssignmentRoomSnapshot,
): ValidationResult<RoomMoneyProjection> {
  const active = room.participants
    .filter((participant) => !participant.removed)
    .sort((a, b) => a.ordinal - b.ordinal);
  const ordinalById = new Map(active.map((participant) => [participant.id, participant.ordinal]));
  const indexById = new Map(active.map((participant, index) => [participant.id, index]));
  const items = [...room.items].sort((a, b) => a.ordinal - b.ordinal);

  const itemsCents = active.map(() => 0);
  const lineCounts = active.map(() => 0);
  const byItem: Record<string, RoomItemMoney> = {};
  let itemsSubtotalCents = 0;
  let unclaimedItemsCents = 0;
  let unownedLineCount = 0;

  for (const item of items) {
    const lineClaims: LineClaim[] = room.claims
      .filter((claim) => claim.itemId === item.id && ordinalById.has(claim.participantId))
      .map((claim) => ({
        participantId: claim.participantId,
        ordinal: ordinalById.get(claim.participantId)!,
        ticks: claim.ticks,
      }));
    const line = allocateLine(item, lineClaims);
    if (!line.ok) return line;

    itemsSubtotalCents += item.totalPriceCents;
    unclaimedItemsCents += line.value.unclaimedCents;
    if (line.value.remainingTicks > 0) unownedLineCount += 1;
    byItem[item.id] = {
      claims: lineClaims.map((claim) => {
        const amountCents = line.value.owned.get(claim.participantId) ?? 0;
        const index = indexById.get(claim.participantId)!;
        itemsCents[index] += amountCents;
        if (claim.ticks > 0) lineCounts[index] += 1;
        return { participantId: claim.participantId, ticks: claim.ticks, amountCents };
      }),
      remainingTicks: line.value.remainingTicks,
      unclaimedCents: line.value.unclaimedCents,
    };
  }

  const serviceFee = computeServiceFeeCents(itemsSubtotalCents, room.serviceFeeBasisPoints);
  if (!serviceFee.ok) return serviceFee;
  const totalCents = itemsSubtotalCents + serviceFee.value + room.fixedFeeCents;
  if (totalCents > (MAX_EXPENSE_CENTS as number)) {
    return { ok: false, issue: { code: "derived_amount_out_of_range", field: "grand_total" } };
  }
  // The unowned bucket carries its weighted slice of the service fee (it will
  // land on whoever takes those items) and none of the per-person fixed fee.
  const serviceShares = allocateByWeights(serviceFee.value, [...itemsCents, unclaimedItemsCents]);
  if (!serviceShares.ok) return serviceShares;
  const fixedShares = allocateEvenly(room.fixedFeeCents, active.length);
  if (!fixedShares.ok) return fixedShares;

  const byParticipant: Record<string, RoomParticipantMoney> = {};
  active.forEach((participant, index) => {
    byParticipant[participant.id] = {
      itemsCents: itemsCents[index],
      withFeeCents: itemsCents[index] + serviceShares.value[index] + fixedShares.value[index],
      serviceFeeCents: serviceShares.value[index],
      fixedFeeCents: fixedShares.value[index],
      lineCount: lineCounts[index],
    };
  });

  return {
    ok: true,
    value: {
      itemsSubtotalCents,
      claimedItemsCents: itemsSubtotalCents - unclaimedItemsCents,
      unclaimedItemsCents,
      unownedLineCount,
      totalCents,
      serviceFeeBasisPoints: room.serviceFeeBasisPoints,
      byParticipant,
      byItem,
    },
  };
}

/** Line cents `participantId` would own if their ticks on `itemId` became `ticks`. */
export function previewClaimCents(
  room: AssignmentRoomSnapshot,
  itemId: string,
  participantId: string,
  ticks: number,
): ValidationResult<number> {
  const item = room.items.find((candidate) => candidate.id === itemId);
  const ordinalById = new Map(
    room.participants.filter((participant) => !participant.removed).map((participant) => [participant.id, participant.ordinal]),
  );
  const ordinal = ordinalById.get(participantId);
  if (!item || ordinal === undefined || ticks === 0) return { ok: true, value: 0 };
  const lineClaims: LineClaim[] = room.claims
    .filter((claim) => claim.itemId === itemId && claim.participantId !== participantId && ordinalById.has(claim.participantId))
    .map((claim) => ({ participantId: claim.participantId, ordinal: ordinalById.get(claim.participantId)!, ticks: claim.ticks }));
  lineClaims.push({ participantId, ordinal, ticks });
  const line = allocateLine(item, lineClaims);
  if (!line.ok) return line;
  return { ok: true, value: line.value.owned.get(participantId) ?? 0 };
}

/**
 * Line cents per participant when `shares` became the item's split: the line
 * keeps the active saved claims, with every participant in `shares` replaced
 * by its share ticks (0 drops the claim) and shares for unknown or removed
 * participants ignored. Only participants with ticks over 0 appear. An
 * unknown item previews as an empty map; an over-capacity split fails with
 * the same error the projection reports.
 */
export function previewItemSplitCents(
  room: AssignmentRoomSnapshot,
  itemId: string,
  shares: readonly AssignmentItemShare[],
): ValidationResult<ReadonlyMap<string, number>> {
  const item = room.items.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: true, value: new Map() };
  const ordinalById = new Map(
    room.participants
      .filter((participant) => !participant.removed)
      .map((participant) => [participant.id, participant.ordinal]),
  );
  const shareTicks = new Map(
    shares.map((share) => [share.participantId, share.ticks]),
  );
  const lineClaims: LineClaim[] = room.claims
    .filter((claim) => claim.itemId === itemId && ordinalById.has(claim.participantId))
    .map((claim) => ({
      participantId: claim.participantId,
      ordinal: ordinalById.get(claim.participantId)!,
      ticks: shareTicks.get(claim.participantId) ?? claim.ticks,
    }));
  for (const [participantId, ticks] of shareTicks) {
    if (
      ticks > 0 &&
      ordinalById.has(participantId) &&
      !lineClaims.some((claim) => claim.participantId === participantId)
    ) {
      lineClaims.push({
        participantId,
        ordinal: ordinalById.get(participantId)!,
        ticks,
      });
    }
  }
  const claimed = lineClaims.filter((claim) => claim.ticks > 0);
  const line = allocateLine(item, claimed);
  if (!line.ok) return line;
  const value = new Map<string, number>();
  for (const claim of claimed) {
    value.set(claim.participantId, line.value.owned.get(claim.participantId) ?? 0);
  }
  return { ok: true, value };
}
