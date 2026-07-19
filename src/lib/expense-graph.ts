/**
 * Canonical expense-graph identity types.
 *
 * These are the participant-map, share, guest-share, and payer row shapes that
 * issues #468 (persisted participant map / allocation plan) and #495 (payer
 * reachability) consume. #477 defines them here so that allocation validators,
 * selectors, and the eventual snapshot decoder share one identity contract.
 *
 * Payer identity is always a registered user (#495): there is no guest-payer or
 * payer-only role. A zero-cent user share is identity-bearing and remains
 * payer-eligible; group membership alone does not make a user a participant.
 *
 * `guestLocalId` is request/wire-only (`"g:" || participant_index`); the
 * database stores the expense-owned guest UUID. The snapshot loader projects
 * deterministic generation-local keys; `buildDraftParams` resolves them back to
 * persisted/internal guest UUIDs at graph-save time.
 */

import type { ExpenseCents } from "./expense-money";

/**
 * One entry in the canonical participant order persisted with the draft graph.
 *
 * Users and entity-backed guests each appear exactly once, in reviewed order.
 * The order is the deterministic tie-break for otherwise-equivalent pair
 * decomposition in the allocation plan; it is independent of UUID.
 */
export type ParticipantOrderEntry = Readonly<
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestLocalId: string }
>;

/**
 * A registered user's canonical share row. Zero centavos is valid and
 * identity-bearing: it preserves participant membership and payer eligibility.
 */
export type CanonicalShareRow = Readonly<{
  userId: string;
  shareAmountCents: ExpenseCents;
}>;

/**
 * A guest's canonical share row keyed by its request/wire local id. Zero
 * centavos is valid and identity-bearing.
 */
export type CanonicalGuestShareRow = Readonly<{
  guestLocalId: string;
  shareAmountCents: ExpenseCents;
}>;

/**
 * A registered-user payer row. `userId` is always a canonical user participant
 * with exactly one matching `CanonicalShareRow`; guests cannot pay. Amount is
 * strictly positive; a zero payer selection is client-only sparse state that
 * the trusted application adapter omits before persistence.
 */
export type CanonicalPayerRow = Readonly<{
  userId: string;
  amountCents: ExpenseCents;
}>;

