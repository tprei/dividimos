import { describe, expect, it } from "vitest";
import {
  parseExpenseCents,
  parseGraphRevision,
  type ExpenseCents,
  type GraphRevision,
} from "./expense-money";
import type {
  BillDraftQuerySource,
  DetachedExpenseSaveOperation,
  DraftAllocationState,
  DraftMutationCapture,
  DraftMutationState,
  DraftSessionState,
  DraftSourceIssue,
} from "./draft-session";

// This is a compile fixture (issue #477 part 2's own convention): every
// exported symbol is imported, and one literal per discriminated-union
// variant is assigned to its exported type. A future edit that narrows or
// breaks a variant incompatibly fails `tsc`, not just at the (nonexistent,
// since this module has no runtime logic) call sites.

function c(value: number): ExpenseCents {
  const result = parseExpenseCents(value, "positive");
  if (!result.ok) throw new Error("invalid fixture cents");
  return result.value;
}

function rev(value: number): GraphRevision {
  const result = parseGraphRevision(value);
  if (!result.ok) throw new Error("invalid fixture revision");
  return result.value;
}

describe("BillDraftQuerySource", () => {
  it("accepts every discriminated variant", () => {
    const existing: BillDraftQuerySource = {
      kind: "existing",
      accountId: "acct-1",
      draftId: "draft-1",
    };
    const dm: BillDraftQuerySource = {
      kind: "dm",
      accountId: "acct-1",
      dmUserId: "user-2",
      groupId: "group-1",
      expenseType: "single_amount",
      step: null,
    };
    const quickEdit: BillDraftQuerySource = {
      kind: "quick_edit",
      accountId: "acct-1",
      groupId: "group-1",
      title: "Pizza",
      amountCents: c(1000),
      step: "participants",
    };
    const manualNoType: BillDraftQuerySource = {
      kind: "manual",
      accountId: "acct-1",
      groupId: null,
      expenseType: null,
      step: null,
    };
    const manualTyped: BillDraftQuerySource = {
      kind: "manual",
      accountId: "acct-1",
      groupId: "group-1",
      expenseType: "itemized",
      step: "payer",
    };

    for (const source of [existing, dm, quickEdit, manualNoType, manualTyped]) {
      expect(source.accountId).toBe("acct-1");
    }
  });
});

describe("DraftSourceIssue", () => {
  it("accepts a wizard-owned link/authority issue", () => {
    const issue: DraftSourceIssue = { code: "invalid_link" };
    expect(issue.code).toBe("invalid_link");
  });
});

describe("DraftAllocationState", () => {
  it("accepts unallocated, preserved/allocated, and stale variants", () => {
    const unallocated: DraftAllocationState = {
      status: "unallocated",
      participantOrder: [],
      itemAssignments: { kind: "aggregate_only" },
    };
    const preserved: DraftAllocationState = {
      status: "preserved",
      participantOrder: [{ kind: "user", userId: "u1" }],
      shares: [{ userId: "u1", shareAmountCents: c(500) }],
      guestShares: [],
      payers: [{ userId: "u1", amountCents: c(500) }],
      itemAssignments: { kind: "aggregate_only" },
    };
    const stale: DraftAllocationState = {
      status: "stale",
      participantOrder: [{ kind: "user", userId: "u1" }],
      shares: [{ userId: "u1", shareAmountCents: c(500) }],
      guestShares: [],
      payers: [],
      itemAssignments: { kind: "detailed", rows: [] },
      reason: "money",
    };

    expect(unallocated.status).toBe("unallocated");
    expect(preserved.status).toBe("preserved");
    expect(stale.reason).toBe("money");
  });
});

describe("DraftMutationState", () => {
  it("accepts idle, saving, and activating captures", () => {
    const capture: DraftMutationCapture = {
      token: 1,
      generation: 1,
      sourceKey: "manual:acct-1",
      navigationEpoch: 0,
      expenseId: null,
      expectedGraphRevision: rev(0),
      capturedLocalRevision: 0,
    };
    const idle: DraftMutationState = { status: "idle" };
    const saving: DraftMutationState = {
      ...capture,
      status: "saving",
      saveOperationId: "11111111-1111-1111-1111-111111111111",
    };
    const activating: DraftMutationState = { ...capture, status: "activating" };

    expect(idle.status).toBe("idle");
    expect(saving.status).toBe("saving");
    expect(activating.status).toBe("activating");
  });
});

describe("DetachedExpenseSaveOperation", () => {
  it("accepts in-flight and committed variants", () => {
    const inFlight: DetachedExpenseSaveOperation = {
      saveOperationId: "op-1",
      accountId: "acct-1",
      groupId: "group-1",
      sourceSessionId: "session-1",
      requestDigestHex: "deadbeef",
      recoveryMode: "bind_if_live",
      capturedLocalRevision: 0,
      status: "in_flight",
    };
    const committed: DetachedExpenseSaveOperation = {
      saveOperationId: "op-1",
      accountId: "acct-1",
      groupId: "group-1",
      sourceSessionId: "session-1",
      requestDigestHex: "deadbeef",
      recoveryMode: "detached_only",
      capturedLocalRevision: 0,
      status: "committed",
      expenseId: "expense-1",
      graphRevision: rev(1),
    };

    expect(inFlight.status).toBe("in_flight");
    expect(committed.status).toBe("committed");
  });
});

describe("DraftSessionState", () => {
  it("composes every field into one coherent ready session", () => {
    const session: DraftSessionState = {
      generation: 1,
      inputResetRevision: 0,
      sourceKey: "manual:acct-1",
      navigationEpoch: 0,
      accountId: "acct-1",
      authority: { status: "ready" },
      groupId: "group-1",
      draftClaimProtectedUserIds: [],
      localRevision: 0,
      persisted: null,
      remoteConflict: null,
      latestLoadToken: 1,
      latestMutationToken: 0,
      mutation: { status: "idle" },
      queuedRemoteInvalidation: false,
      allocation: {
        status: "unallocated",
        participantOrder: [],
        itemAssignments: { kind: "aggregate_only" },
      },
    };

    expect(session.authority.status).toBe("ready");
    expect(session.mutation.status).toBe("idle");
    expect(session.allocation.status).toBe("unallocated");
  });

  it("composes a loading/unavailable session with a persisted binding", () => {
    const session: DraftSessionState = {
      generation: 2,
      inputResetRevision: 1,
      sourceKey: "existing:acct-1:draft-1",
      navigationEpoch: 1,
      accountId: "acct-1",
      authority: { status: "unavailable", issue: { code: "not_found" } },
      groupId: "group-1",
      draftClaimProtectedUserIds: ["u-protected"],
      localRevision: 3,
      persisted: { expenseId: "draft-1", graphRevision: rev(2), localRevision: 3 },
      remoteConflict: { status: "observed", graphRevision: rev(3) },
      latestLoadToken: 2,
      latestMutationToken: 1,
      mutation: { status: "idle" },
      queuedRemoteInvalidation: true,
      allocation: {
        status: "stale",
        participantOrder: [],
        shares: [],
        guestShares: [],
        payers: [],
        itemAssignments: { kind: "aggregate_only" },
        reason: "participant",
      },
    };

    expect(session.authority.status).toBe("unavailable");
    expect(session.draftClaimProtectedUserIds).toEqual(["u-protected"]);
    expect(session.remoteConflict?.status).toBe("observed");
  });
});
