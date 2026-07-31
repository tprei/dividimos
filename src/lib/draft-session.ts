/**
 * Draft session domain: the wizard's single source-of-truth state contract
 * for a bill-entry session (issue #477, "Slice 5" — the wizard
 * `DraftSessionState`/`DraftMutationState` rearchitecture).
 *
 * This module owns only the *type contract* the spec normatively defines
 * (issue #477 part 3, comment
 * https://github.com/tprei/dividimos/issues/477#issuecomment-4979158884).
 * It knows no React, no Zustand, and no Supabase client: it is a
 * dependency-free description of what one wizard session's state must be
 * able to represent so that generation/navigation-epoch coordination,
 * single-flight save/activate mutation tokens, durable cross-tab save
 * recovery, and allocation staleness tracking are all expressible without a
 * parallel ad hoc shape.
 *
 * Consuming this contract to replace `src/stores/bill-store.ts`'s current
 * state shape and `src/app/app/bill/new/page.tsx`'s query-source /
 * mutation-dispatch effects is the remainder of Slice 5 and is intentionally
 * not done by this module alone — per the spec, only a real, coordinated
 * migration of the actual mutation/save/activation/realtime call sites (not
 * a parallel unused type) satisfies it. This module exists so that
 * migration has one exact, spec-matching target contract to build against,
 * incrementally, across the reviewable stacked PRs a change this size
 * requires (see `agent-guidance/writing/STACKED_DIFFS.md`).
 */

import type {
  ExpenseCents,
  ExpenseDecodeIssue,
  ExpenseGraphSnapshotIssue,
  ExpenseTextIssue,
  GraphRevision,
} from "./expense-money";
import type {
  CanonicalGuestShareRow,
  CanonicalPayerRow,
  CanonicalShareRow,
  ParticipantOrderEntry,
} from "./expense-graph";
import type { CanonicalItemAssignment } from "./expense-money";

// ---------------------------------------------------------------------------
// Query source: the one decoded union replacing the wizard's four
// independent query-parsing effects (issue #477 part 3).
// ---------------------------------------------------------------------------

/**
 * The wizard's single decoded entry-point union. `draft` is exclusive; `dm`
 * requires `groupId` and forbids `draft`/`title`/`amount`; `quick_edit`
 * requires `groupId` plus a nonempty bounded `title` and a positive
 * integer-cent `amount`; `manual` consumes only optional group/type/step
 * context, with an omitted type decoding to the explicit
 * `expenseType: null, step: null` type-selection state.
 */
export type BillDraftQuerySource =
  | Readonly<{ kind: "existing"; accountId: string; draftId: string }>
  | Readonly<{
      kind: "dm";
      accountId: string;
      dmUserId: string;
      groupId: string;
      expenseType: "single_amount" | "itemized";
      step: "participants" | "payer" | null;
    }>
  | Readonly<{
      kind: "quick_edit";
      accountId: string;
      groupId: string;
      title: string;
      amountCents: ExpenseCents;
      step: "participants" | "payer" | null;
    }>
  | Readonly<{
      kind: "manual";
      accountId: string;
      groupId: string | null;
      expenseType: null;
      step: null;
    }>
  | Readonly<{
      kind: "manual";
      accountId: string;
      groupId: string | null;
      expenseType: "single_amount" | "itemized";
      step: "participants" | "payer" | null;
    }>;

// ---------------------------------------------------------------------------
// Source/authority/allocation issues.
// ---------------------------------------------------------------------------

/**
 * Every reason a draft session's `authority` may be `unavailable`: a
 * malformed/conflicting `BillDraftQuerySource`, an authorization/lookup
 * failure from the graph loader, a decode failure of its response, an
 * invalid raw money/text edit, or a non-editable (active/settled) status on
 * an `existing` source.
 */
export type DraftSourceIssue =
  | ExpenseGraphSnapshotIssue
  | ExpenseDecodeIssue
  | ExpenseTextIssue
  | Readonly<{
      code:
        | "invalid_link"
        | "unauthorized"
        | "not_found"
        | "transport"
        | "non_editable_status";
    }>;

/**
 * The session's authoritative share/guest-share/payer/item-assignment
 * state, replacing inference from component-local arrays. `unallocated` has
 * no rows yet; `preserved` is hydrated-and-untouched server state;
 * `allocated` is a fresh in-session explicit allocation; `stale` retains
 * every unaffected row after a money/type/participant/guest change until
 * explicit reallocation.
 */
export type DraftAllocationState =
  | Readonly<{
      status: "unallocated";
      participantOrder: readonly ParticipantOrderEntry[];
      itemAssignments: Readonly<{ kind: "aggregate_only" }>;
    }>
  | Readonly<{
      status: "preserved" | "allocated";
      participantOrder: readonly ParticipantOrderEntry[];
      shares: readonly CanonicalShareRow[];
      guestShares: readonly CanonicalGuestShareRow[];
      payers: readonly CanonicalPayerRow[];
      itemAssignments:
        | Readonly<{ kind: "aggregate_only" }>
        | Readonly<{ kind: "detailed"; rows: readonly CanonicalItemAssignment[] }>;
    }>
  | Readonly<{
      status: "stale";
      participantOrder: readonly ParticipantOrderEntry[];
      shares: readonly CanonicalShareRow[];
      guestShares: readonly CanonicalGuestShareRow[];
      payers: readonly CanonicalPayerRow[];
      itemAssignments:
        | Readonly<{ kind: "aggregate_only" }>
        | Readonly<{ kind: "detailed"; rows: readonly CanonicalItemAssignment[] }>;
      reason: "money" | "type" | "participant" | "guest";
    }>;

// ---------------------------------------------------------------------------
// Mutation (save/activate) single-flight coordination.
// ---------------------------------------------------------------------------

/**
 * The identity/CAS fields captured atomically when a save or activation
 * mutation starts, so a late-arriving response can be checked against the
 * exact session it was dispatched from before it is ever applied.
 */
export type DraftMutationCapture = Readonly<{
  token: number;
  generation: number;
  sourceKey: string;
  navigationEpoch: number;
  expenseId: string | null;
  expectedGraphRevision: GraphRevision;
  capturedLocalRevision: number;
}>;

/**
 * The session's one mounted mutation slot. Starting a save or activation
 * synchronously installs `saving`/`activating` before dispatch; while
 * non-idle, every mutating control is disabled. Transport/decode
 * uncertainty after a save/activation attempt moves to the matching
 * `reconciling_*` state, which resolves only through an authoritative
 * lookup — never a guess.
 */
export type DraftMutationState =
  | Readonly<{ status: "idle" }>
  | (DraftMutationCapture &
      Readonly<{ status: "saving" | "reconciling_save"; saveOperationId: string }>)
  | (DraftMutationCapture & Readonly<{ status: "activating" | "reconciling_activation" }>);

/**
 * The durable, account-scoped, cross-tab record persisted before any
 * ID-absent save dispatches, so a crash between commit and route handoff
 * can always be reconciled through `resolve_expense_graph_save_result`
 * rather than silently duplicating or losing a draft. Durable storage
 * carries only the digest/identifiers — no money, title, participant,
 * guest, or receipt data.
 */
export type DetachedExpenseSaveOperation = Readonly<{
  saveOperationId: string;
  accountId: string;
  groupId: string;
  sourceSessionId: string;
  requestDigestHex: string;
  recoveryMode: "bind_if_live" | "detached_only";
  capturedLocalRevision: number;
}> &
  (
    | Readonly<{ status: "in_flight" | "unknown" | "retired" }>
    | Readonly<{ status: "committed"; expenseId: string; graphRevision: GraphRevision }>
  );

// ---------------------------------------------------------------------------
// The one draft session state.
// ---------------------------------------------------------------------------

/**
 * The wizard's single source-of-truth session state (issue #477 part 2/3).
 * `generation` bumps on every new source/account/draft/group-change load and
 * atomically clears all prior graph data before the next load may install
 * `ready`; `navigationEpoch` additionally invalidates in-flight
 * requests/callbacks on source/account/group/draft change (but not on an
 * input-only reset or type change); `inputResetRevision` is passed to every
 * `CurrencyInput`/`AmountQuickAdd` so a record switch cannot leave stale
 * invalid text behind. `localRevision` increments on every canonical
 * money/allocation mutation and every raw money/percentage text or validity
 * edit, including an invalid edit that leaves cents unchanged.
 */
export type DraftSessionState = Readonly<{
  generation: number;
  inputResetRevision: number;
  sourceKey: string | null;
  navigationEpoch: number;
  accountId: string | null;
  authority:
    | Readonly<{ status: "loading" }>
    | Readonly<{ status: "ready" }>
    | Readonly<{ status: "stale_snapshot"; issue: ExpenseGraphSnapshotIssue }>
    | Readonly<{ status: "unavailable"; issue: DraftSourceIssue }>;
  groupId: string | null;
  draftClaimProtectedUserIds: readonly string[];
  localRevision: number;
  persisted: Readonly<{
    expenseId: string;
    graphRevision: GraphRevision;
    localRevision: number;
  }> | null;
  remoteConflict:
    | Readonly<{ status: "pending" }>
    | Readonly<{ status: "observed"; graphRevision: GraphRevision }>
    | null;
  latestLoadToken: number;
  latestMutationToken: number;
  mutation: DraftMutationState;
  queuedRemoteInvalidation: boolean;
  allocation: DraftAllocationState;
}>;
