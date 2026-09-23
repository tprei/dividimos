import {
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_ITEMS,
  allocateByWeights,
  allocateEvenly,
  brandExpenseCents,
  computeServiceFeeCents,
  parseExpenseCents,
  parseServiceFeeBasisPoints,
  validateActivationAllocationTotals,
  type ExpenseCents,
  type ExpenseMoneyIssue,
  type ValidationResult,
} from "@/lib/expense-money";
import {
  computeExpenseLineTotalCents,
  MAX_EXPENSE_QUANTITY_MILLIUNITS,
  type ExpenseQuantity,
  type QuantityValidationIssue,
} from "@/lib/expense-quantity";
import type {
  AssignmentRoomItem,
  AssignmentRoomParticipant,
  AssignmentRoomView,
} from "@/types/assignment-room";
import type {
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
  ExpensePayerPayload,
  ExpensePayload,
  ParticipantRef,
} from "@/types/ledger";

/**
 * Assignment-room claim math: raw tick conversion, tick-weighted item
 * allocation, and canonical expense materialization.
 *
 * Room ticks are the resolution of item claims: one milliunit of item quantity
 * is `ROOM_TICKS_PER_MILLIUNIT` ticks. 120 is divisible by every allowed claim
 * denominator (1, 2, 3, 4, 5, 6, 8, 10), so tick conversion is always an exact
 * integer product — nothing here rounds. The full capacity of the largest
 * quantity (`999.999`) is 119_999_999_880 ticks, safely below 2^53.
 *
 * Tick weights are not money: the per-expense cent cap must never bound them.
 * `allocateByWeights` validates weights as money and cannot take raw ticks, so
 * the item allocator below reimplements the same largest-remainder algorithm
 * with bigint products and tick-range validation instead. Fees reuse the
 * existing allocators unchanged: `computeServiceFeeCents` stays authoritative
 * for the fee itself, `allocateByWeights` distributes service-fee cents by
 * item shares, and `allocateEvenly` distributes the fixed fee.
 *
 * Failures reuse the existing `ExpenseMoneyIssue` codes (the default issue
 * type of `ValidationResult`): structural or identity defects (non-integer,
 * negative, zero, unknown id, ineligible payer) report `invalid_cents` with a
 * path naming the offending input; bound violations report
 * `amount_out_of_range`; an item whose active claims fall short of capacity
 * reports `incomplete_expense` and an overclaim reports
 * `allocation_exceeds_total`; fee and item fields reuse `invalid_service_fee`,
 * `invalid_quantity`, and `invalid_item_cents`.
 */

/** Room tick resolution: ticks per milliunit of item quantity. */
export const ROOM_TICKS_PER_MILLIUNIT = 120 as const;

/**
 * Tick capacity of the largest claimable quantity:
 * `MAX_EXPENSE_QUANTITY_MILLIUNITS * ROOM_TICKS_PER_MILLIUNIT`. Stays below
 * 2^53, so every tick value is a safe integer.
 */
const MAX_CLAIM_TICKS =
  MAX_EXPENSE_QUANTITY_MILLIUNITS * ROOM_TICKS_PER_MILLIUNIT;

/** Denominators that divide `ROOM_TICKS_PER_MILLIUNIT` exactly. */
const CLAIM_DENOMINATORS = new Set<number>([1, 2, 3, 4, 5, 6, 8, 10]);

const MAX_EXPENSE_CENTS_BIG = BigInt(MAX_EXPENSE_CENTS as number);

function fail<T>(issue: ExpenseMoneyIssue): ValidationResult<T> {
  return { ok: false, issue };
}

/** Shared quantity guard: safe, positive, within the quantity bound. */
function quantityIssue(quantityMilliunits: number): ExpenseMoneyIssue | null {
  if (
    !Number.isFinite(quantityMilliunits) ||
    !Number.isInteger(quantityMilliunits) ||
    quantityMilliunits <= 0
  ) {
    return { code: "invalid_cents", path: ["quantityMilliunits"] };
  }
  if (quantityMilliunits > MAX_EXPENSE_QUANTITY_MILLIUNITS) {
    return { code: "amount_out_of_range", path: ["quantityMilliunits"] };
  }
  return null;
}

/** Snapshot quantity guard mapped onto the existing quantity issue codes. */
function itemQuantityIssue(
  quantityMilliunits: number,
): QuantityValidationIssue | null {
  if (!Number.isFinite(quantityMilliunits)) return { code: "nonfinite" };
  if (!Number.isInteger(quantityMilliunits)) return { code: "invalid_format" };
  if (quantityMilliunits <= 0) return { code: "nonpositive" };
  if (quantityMilliunits > MAX_EXPENSE_QUANTITY_MILLIUNITS) {
    return { code: "out_of_range" };
  }
  return null;
}

/** Exact tick product, range-checked against the tick capacity bound. */
function ticksResult(ticksBig: bigint): ValidationResult<number> {
  if (ticksBig > BigInt(MAX_CLAIM_TICKS)) {
    return { ok: false, issue: { code: "amount_out_of_range", path: ["ticks"] } };
  }
  return { ok: true, value: Number(ticksBig) };
}

/**
 * Exact claim ticks for a plain quantity: `quantityMilliunits * 120`.
 * Rejects zero, negative, fractional, nonfinite, and above-bound quantities
 * explicitly instead of rounding; the maximum quantity yields
 * `119_999_999_880` ticks without overflow.
 */
export function claimTicksForQuantity(
  quantityMilliunits: number,
): ValidationResult<number> {
  const issue = quantityIssue(quantityMilliunits);
  if (issue) return fail(issue);
  return ticksResult(
    BigInt(quantityMilliunits) * BigInt(ROOM_TICKS_PER_MILLIUNIT),
  );
}

/**
 * Exact claim ticks for a fraction of a quantity:
 * `quantityMilliunits * numerator * (120 / denominator)`. Every allowed
 * denominator divides 120, so the product is exact for any safe quantity.
 * Validates the quantity, denominator membership in `1, 2, 3, 4, 5, 6, 8, 10`,
 * and `0 <= numerator <= denominator`; a numerator above the denominator
 * fails instead of being clamped.
 */
export function claimTicksForFraction(
  quantityMilliunits: number,
  numerator: number,
  denominator: number,
): ValidationResult<number> {
  const issue = quantityIssue(quantityMilliunits);
  if (issue) return fail(issue);
  if (!Number.isInteger(numerator) || numerator < 0) {
    return fail({ code: "invalid_cents", path: ["numerator"] });
  }
  if (!CLAIM_DENOMINATORS.has(denominator)) {
    return fail({ code: "invalid_cents", path: ["denominator"] });
  }
  if (numerator > denominator) {
    return fail({ code: "amount_out_of_range", path: ["numerator"] });
  }
  const ticksPerDenominator = ROOM_TICKS_PER_MILLIUNIT / denominator;
  return ticksResult(
    BigInt(quantityMilliunits) *
      BigInt(numerator) *
      BigInt(ticksPerDenominator),
  );
}

/**
 * Allocate one item's cents across its claims with the largest-remainder
 * algorithm: `base_i = floor(totalCents * ticks_i / sumTicks)` in `bigint`,
 * leftover cents one each by descending exact remainder, ties broken by
 * ascending ordinal (then input order — the comparator is explicit because the
 * ES2017 target does not guarantee sort stability). Rows return in ascending
 * ordinal order, one per claim.
 *
 * The weight denominator is the sum of the supplied ticks, so the caller MUST
 * pass a complete claim set — ticks summing to the item capacity
 * `quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT` — or the whole line is
 * silently split among the partial claims. `buildAssignmentExpense` verifies
 * exact capacity equality before calling.
 *
 * Unlike `allocateByWeights`, weights are raw ticks validated against the tick
 * capacity bound, never the per-expense cent cap.
 */
export function allocateAssignmentItemCents(
  totalCents: number,
  claims: readonly { participantId: string; ordinal: number; ticks: number }[],
): ValidationResult<readonly { participantId: string; amountCents: number }[]> {
  if (claims.length === 0) {
    return fail({ code: "invalid_allocation_weights", reason: "no_entities" });
  }
  const totalResult = parseExpenseCents(totalCents, "allow");
  if (!totalResult.ok) {
    return fail(
      totalResult.issue.code === "invalid_cents"
        ? { code: "invalid_cents", path: ["totalCents"] }
        : { code: "amount_out_of_range", path: ["totalCents"] },
    );
  }
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    if (
      typeof claim.participantId !== "string" ||
      claim.participantId.length === 0
    ) {
      return fail({
        code: "invalid_cents",
        path: ["claims", i, "participantId"],
      });
    }
    if (!Number.isSafeInteger(claim.ordinal) || claim.ordinal < 0) {
      return fail({ code: "invalid_cents", path: ["claims", i, "ordinal"] });
    }
    if (!Number.isSafeInteger(claim.ticks) || claim.ticks < 0) {
      return fail({ code: "invalid_cents", path: ["claims", i, "ticks"] });
    }
    if (claim.ticks > MAX_CLAIM_TICKS) {
      return fail({
        code: "amount_out_of_range",
        path: ["claims", i, "ticks"],
      });
    }
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < claims.length; i++) {
    if (seenIds.has(claims[i].participantId)) {
      return fail({
        code: "invalid_cents",
        path: ["claims", i, "participantId"],
      });
    }
    seenIds.add(claims[i].participantId);
  }
  const ordered = claims
    .map((claim, index) => ({ claim, index }))
    .sort((a, b) =>
      a.claim.ordinal === b.claim.ordinal
        ? a.index - b.index
        : a.claim.ordinal < b.claim.ordinal
          ? -1
          : 1,
    );
  if (totalCents === 0) {
    return {
      ok: true,
      value: Object.freeze(
        ordered.map(({ claim }) => ({
          participantId: claim.participantId,
          amountCents: 0,
        })),
      ),
    };
  }
  let ticksSum = BigInt(0);
  for (const { claim } of ordered) {
    ticksSum += BigInt(claim.ticks);
  }
  if (ticksSum === BigInt(0)) {
    return fail({ code: "invalid_allocation_weights", reason: "zero_weight" });
  }
  const totalBig = BigInt(totalCents);
  const bases: bigint[] = [];
  const remainders: bigint[] = [];
  let baseSum = BigInt(0);
  for (const { claim } of ordered) {
    const product = totalBig * BigInt(claim.ticks);
    const base = product / ticksSum;
    bases.push(base);
    remainders.push(product - base * ticksSum);
    baseSum += base;
  }
  const toDistribute = Number(totalBig - baseSum);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const amounts = bases.map((base) => Number(base));
  for (let k = 0; k < toDistribute; k++) {
    amounts[order[k].index] += 1;
  }
  for (const amount of amounts) {
    if (amount > (MAX_EXPENSE_CENTS as number)) {
      return fail({ code: "amount_out_of_range", path: [] });
    }
  }
  return {
    ok: true,
    value: Object.freeze(
      ordered.map(({ claim }, i) => ({
        participantId: claim.participantId,
        amountCents: amounts[i],
      })),
    ),
  };
}

/**
 * Payer-independent materialization shared by the division and expense
 * builders: the canonical payload with no payers attached, plus the
 * intermediate active participants, refs, and grand total that the payer
 * validation reuses.
 *
 * Active participants (removed omitted) are ordered by immutable ordinal —
 * snapshot order breaking exact ties — and compacted to canonical participant
 * indexes. The host (`selfParticipantId`) stays in the list even at zero
 * consumption, so `shares` is dense over every active participant. Every item
 * must first satisfy exact capacity equality: the ticks its active
 * participants claim must sum to `quantityMilliunits *
 * ROOM_TICKS_PER_MILLIUNIT`. Only then are item cents, fees, and shares
 * materialized; claims of removed participants are omitted while claims of
 * unknown participants fail.
 */
interface AssignmentDivisionState {
  payload: ExpensePayload;
  active: { participant: AssignmentRoomParticipant; index: number }[];
  refByParticipantId: Map<string, ParticipantRef>;
  grandTotalCents: number;
}

function buildAssignmentDivisionState(
  view: Extract<AssignmentRoomView, { role: "host" }>,
): ValidationResult<AssignmentDivisionState> {
  const room = view.room;
  if (
    room.items.length === 0 ||
    room.items.length > (MAX_EXPENSE_ITEMS as number)
  ) {
    return fail({ code: "invalid_item_collection", reason: "count" });
  }
  if (room.status !== "closed" || room.currentBill !== null) {
    return fail({ code: "incomplete_expense" });
  }

  const participantIds = new Set<string>();
  const participantOrdinals = new Set<number>();
  for (let i = 0; i < room.participants.length; i++) {
    const participant = room.participants[i];
    if (
      participant.id.length === 0 ||
      participantIds.has(participant.id) ||
      !Number.isSafeInteger(participant.ordinal) ||
      participant.ordinal < 0 ||
      participantOrdinals.has(participant.ordinal)
    ) {
      return fail({ code: "invalid_cents", path: ["participants", i] });
    }
    participantIds.add(participant.id);
    participantOrdinals.add(participant.ordinal);
  }

  const seenItemIds = new Set<string>();
  const seenItemOrdinals = new Set<number>();
  for (let i = 0; i < room.items.length; i++) {
    const item = room.items[i];
    if (
      item.id.length === 0 ||
      seenItemIds.has(item.id) ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 0 ||
      seenItemOrdinals.has(item.ordinal) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0
    ) {
      return fail({ code: "invalid_cents", path: ["items", i] });
    }
    seenItemIds.add(item.id);
    seenItemOrdinals.add(item.ordinal);
  }

  const active = room.participants
    .map((participant, index) => ({ participant, index }))
    .filter(({ participant }) => !participant.removed)
    .sort((a, b) =>
      a.participant.ordinal === b.participant.ordinal
        ? a.index - b.index
        : a.participant.ordinal < b.participant.ordinal
          ? -1
          : 1,
    );
  const canonicalIndexById = new Map(
    active.map(({ participant }, index) => [participant.id, index]),
  );
  if (!canonicalIndexById.has(room.selfParticipantId)) {
    return fail({ code: "invalid_cents", path: ["selfParticipantId"] });
  }
  const refByParticipantId = new Map(
    view.participantRefs.map((entry) => [entry.participantId, entry.ref]),
  );
  const itemIds = new Set(room.items.map((item) => item.id));

  // Pass 1: validate items and claims, then verify exact capacity equality
  // for every item before any total is materialized.
  const participantById = new Map(
    room.participants.map((participant) => [participant.id, participant]),
  );
  const claimsByItemId = new Map<
    string,
    { participantId: string; ordinal: number; ticks: number }[]
  >();
  for (let i = 0; i < room.claims.length; i++) {
    const claim = room.claims[i];
    const participant = participantById.get(claim.participantId);
    if (!participant) {
      return fail({
        code: "invalid_cents",
        path: ["claims", i, "participantId"],
      });
    }
    if (participant.removed) {
      continue;
    }
    if (!Number.isSafeInteger(claim.ticks) || claim.ticks < 0) {
      return fail({ code: "invalid_cents", path: ["claims", i, "ticks"] });
    }
    if (claim.ticks > MAX_CLAIM_TICKS) {
      return fail({
        code: "amount_out_of_range",
        path: ["claims", i, "ticks"],
      });
    }
    if (!itemIds.has(claim.itemId)) {
      return fail({ code: "invalid_cents", path: ["claims", i, "itemId"] });
    }
    let group = claimsByItemId.get(claim.itemId);
    if (!group) {
      group = [];
      claimsByItemId.set(claim.itemId, group);
    }
    group.push({
      participantId: claim.participantId,
      ordinal: participant.ordinal,
      ticks: claim.ticks,
    });
  }

  const orderedItems: { item: AssignmentRoomItem; index: number }[] = room.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.ordinal === b.item.ordinal
        ? a.index - b.index
        : a.item.ordinal < b.item.ordinal
          ? -1
          : 1,
    );

  const itemAssignments: ExpenseItemAssignmentPayload[] = [];
  const itemShareCents: number[] = active.map(() => 0);
  for (let itemIndex = 0; itemIndex < orderedItems.length; itemIndex++) {
    const { item } = orderedItems[itemIndex];
    const quantityDefect = itemQuantityIssue(item.quantityMilliunits);
    if (quantityDefect) {
      return fail({
        code: "invalid_quantity",
        itemIndex,
        issue: quantityDefect,
      });
    }
    const unitPriceResult = parseExpenseCents(item.unitPriceCents, "positive");
    if (!unitPriceResult.ok) {
      return fail({
        code: "invalid_item_cents",
        itemIndex,
        field: "unitPriceCents",
      });
    }
    const lineTotalResult = parseExpenseCents(item.totalPriceCents, "positive");
    if (!lineTotalResult.ok) {
      return fail({
        code: "invalid_item_cents",
        itemIndex,
        field: "totalPriceCents",
      });
    }
    const computedLineTotal = computeExpenseLineTotalCents(
      item.quantityMilliunits as ExpenseQuantity,
      unitPriceResult.value,
    );
    if (!computedLineTotal.ok) {
      return fail({
        code: "invalid_quantity",
        itemIndex,
        issue: computedLineTotal.issue,
      });
    }
    if (computedLineTotal.value !== lineTotalResult.value) {
      return fail({ code: "line_total_mismatch", itemIndex });
    }
    const capacityBig =
      BigInt(item.quantityMilliunits) * BigInt(ROOM_TICKS_PER_MILLIUNIT);
    const group = claimsByItemId.get(item.id) ?? [];
    let ticksSum = BigInt(0);
    for (const claim of group) {
      ticksSum += BigInt(claim.ticks);
    }
    if (ticksSum < capacityBig) {
      return fail({ code: "incomplete_expense" });
    }
    if (ticksSum > capacityBig) {
      return fail({ code: "allocation_exceeds_total", kind: "combined_shares" });
    }
    const allocated = allocateAssignmentItemCents(item.totalPriceCents, group);
    if (!allocated.ok) {
      return allocated;
    }
    for (const row of allocated.value) {
      if (row.amountCents <= 0) {
        continue;
      }
      const participantIndex = canonicalIndexById.get(row.participantId);
      if (participantIndex === undefined) {
        return fail({
          code: "invalid_cents",
          path: ["itemAssignments", itemIndex, "participantIndex"],
        });
      }
      itemAssignments.push({
        itemIndex,
        participantIndex,
        amountCents: row.amountCents,
      });
      itemShareCents[participantIndex] += row.amountCents;
    }
  }

  // Pass 2: materialize totals from the verified capacity.
  let subtotalBig = BigInt(0);
  for (const { item } of orderedItems) {
    subtotalBig += BigInt(item.totalPriceCents);
  }
  if (subtotalBig > MAX_EXPENSE_CENTS_BIG) {
    return fail({ code: "derived_amount_out_of_range", field: "subtotal" });
  }
  const rateResult = parseServiceFeeBasisPoints(room.serviceFeeBasisPoints);
  if (!rateResult.ok) {
    return fail({
      code: "invalid_service_fee",
      path: ["serviceFeeBasisPoints"],
    });
  }
  const fixedFeeResult = parseExpenseCents(room.fixedFeeCents, "allow");
  if (!fixedFeeResult.ok) {
    return fail(
      fixedFeeResult.issue.code === "invalid_cents"
        ? { code: "invalid_cents", path: ["fixedFeeCents"] }
        : { code: "amount_out_of_range", path: ["fixedFeeCents"] },
    );
  }
  const serviceFeeResult = computeServiceFeeCents(
    Number(subtotalBig),
    rateResult.value,
  );
  if (!serviceFeeResult.ok) {
    return serviceFeeResult;
  }
  const grandBig =
    subtotalBig + BigInt(serviceFeeResult.value) + BigInt(fixedFeeResult.value);
  if (grandBig > MAX_EXPENSE_CENTS_BIG) {
    return fail({ code: "derived_amount_out_of_range", field: "grand_total" });
  }
  const roomTotalResult = parseExpenseCents(room.totalCents, "positive");
  if (!roomTotalResult.ok || roomTotalResult.value !== Number(grandBig)) {
    return fail({ code: "itemized_total_mismatch" });
  }

  const serviceShareResult = allocateByWeights(
    serviceFeeResult.value,
    itemShareCents,
  );
  if (!serviceShareResult.ok) {
    return serviceShareResult;
  }
  const fixedShareResult = allocateEvenly(fixedFeeResult.value, active.length);
  if (!fixedShareResult.ok) {
    return fixedShareResult;
  }
  const shares = itemShareCents.map(
    (itemCents, i) =>
      itemCents + serviceShareResult.value[i] + fixedShareResult.value[i],
  );

  const items: ExpenseItemPayload[] = orderedItems.map(({ item }) => ({
    description: item.description,
    quantityMilliunits: item.quantityMilliunits,
    unitPriceCents: item.unitPriceCents,
    totalPriceCents: item.totalPriceCents,
  }));
  const participants: ParticipantRef[] = active.map(({ participant }) => {
    const ref = refByParticipantId.get(participant.id);
    return (
      ref ?? {
        kind: "guest",
        guestId: null,
        displayName: participant.displayName,
      }
    );
  });
  return {
    ok: true,
    value: {
      payload: {
        items,
        participants,
        shares,
        payers: [],
        itemAssignments,
        splitMethod: null,
      },
      active,
      refByParticipantId,
      grandTotalCents: Number(grandBig),
    },
  };
}

/**
 * Materialize the canonical `ExpensePayload` for a finalized receipt room
 * without payer attribution. Validation is identical to
 * `buildAssignmentExpense` minus the payer handling; the returned payload
 * carries `payers: []` and is otherwise the value `buildAssignmentExpense`
 * returns once matching payers are attached. This is the honest preview used
 * before any payer split exists.
 */
export function buildAssignmentDivision(
  view: Extract<AssignmentRoomView, { role: "host" }>,
): ValidationResult<ExpensePayload> {
  const division = buildAssignmentDivisionState(view);
  return division.ok ? { ok: true, value: division.value.payload } : division;
}

/**
 * Materialize the canonical `ExpensePayload` for a finalized receipt room,
 * validating and attaching `payers` on top of `buildAssignmentDivision`.
 *
 * `payers` reference canonical participant indexes and must be registered
 * eligible user participants — a host-supplied `ParticipantRef` of kind
 * `"user"` with a nonempty user id. Guests never become payers, payer indexes
 * are unique, and the payer sum must equal the grand total exactly.
 */
export function buildAssignmentExpense(
  view: Extract<AssignmentRoomView, { role: "host" }>,
  payers: readonly ExpensePayerPayload[],
): ValidationResult<ExpensePayload> {
  const division = buildAssignmentDivisionState(view);
  if (!division.ok) {
    return division;
  }
  const { active, refByParticipantId, grandTotalCents } = division.value;
  const shares = division.value.payload.shares;

  const payerRows: ExpensePayerPayload[] = [];
  const payerCents: ExpenseCents[] = [];
  const payerIndexes = new Set<number>();
  for (let i = 0; i < payers.length; i++) {
    const payer = payers[i];
    const amountResult = parseExpenseCents(payer.amountCents, "positive");
    if (!amountResult.ok) {
      return fail(
        amountResult.issue.code === "invalid_cents"
          ? { code: "invalid_cents", path: ["payers", i, "amountCents"] }
          : { code: "amount_out_of_range", path: ["payers", i, "amountCents"] },
      );
    }
    const participantIndex = payer.participantIndex;
    if (
      !Number.isInteger(participantIndex) ||
      participantIndex < 0 ||
      participantIndex >= active.length ||
      payerIndexes.has(participantIndex)
    ) {
      return fail({
        code: "invalid_cents",
        path: ["payers", i, "participantIndex"],
      });
    }
    const { participant } = active[participantIndex];
    const ref = refByParticipantId.get(participant.id);
    if (
      participant.isGuest ||
      !ref ||
      ref.kind !== "user" ||
      ref.userId.length === 0
    ) {
      return fail({
        code: "invalid_cents",
        path: ["payers", i, "participantIndex"],
      });
    }
    payerIndexes.add(participantIndex);
    payerRows.push({ participantIndex, amountCents: amountResult.value });
    payerCents.push(amountResult.value);
  }

  const totalsResult = validateActivationAllocationTotals({
    totalAmountCents: brandExpenseCents(grandTotalCents),
    userShareCents: shares.map((shareCents) => brandExpenseCents(shareCents)),
    guestShareCents: [],
    payerCents,
  });
  if (!totalsResult.ok) {
    return totalsResult;
  }

  return {
    ok: true,
    value: {
      ...division.value.payload,
      payers: payerRows,
    },
  };
}
