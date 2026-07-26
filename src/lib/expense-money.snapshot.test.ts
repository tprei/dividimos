import { describe, expect, it } from "vitest";
import {
  decodeExpenseGraphSnapshot,
  type DecodedExpenseGraphSnapshot,
  type ExpenseGraphSnapshotIssue,
  type ValidationResult,
} from "./expense-money";

/**
 * Issue #477 `decodeExpenseGraphSnapshot` — the sole loader/client boundary.
 *
 * Fixtures are built inline in snake_case wire form (no live DB). The wire item
 * `quantity` is the source/decimal form that `validateExpenseMoney` consumes
 * (1 = one item); the loader is responsible for converting the persisted
 * milliunits back to that form. `service_fee_basis_points` is the integer basis
 * points (never `service_fee_percent`).
 */

type SnapshotResult = ValidationResult<
  DecodedExpenseGraphSnapshot,
  ExpenseGraphSnapshotIssue
>;

function validDraft(): Record<string, unknown> {
  return {
    expense_id: "exp-draft-1",
    group_id: "grp-1",
    graph_revision: 5,
    title: "Dinner",
    merchant_name: null,
    expense_type: "single_amount",
    total_amount: 1000,
    service_fee_basis_points: 0,
    fixed_fees: 0,
    items: [],
    item_ids: [],
    draft_claim_protected_user_ids: [],
    status: "draft",
    participant_order: [{ kind: "user", user_id: "u-alice" }],
    shares: [{ user_id: "u-alice", share_amount_cents: 1000 }],
    guest_shares: [],
    payers: [{ user_id: "u-alice", amount_cents: 1000 }],
    guests: [],
  };
}

function validActive(): Record<string, unknown> {
  return {
    expense_id: "exp-active-1",
    group_id: "grp-1",
    graph_revision: 3,
    title: "Lunch",
    merchant_name: "Cafe Central",
    expense_type: "itemized",
    total_amount: 1100, // 1000 subtotal + 100 service fee (10.00%)
    service_fee_basis_points: 1000, // 10.00%
    fixed_fees: 0,
    items: [
      {
        id: "item-1",
        description: "Burger",
        quantity: 1, // decimal: one item
        unit_price_cents: 1000,
        total_price_cents: 1000,
      },
    ],
    item_ids: ["item-1"],
    draft_claim_protected_user_ids: [],
    status: "active",
    participant_order: [{ kind: "user", user_id: "u-alice" }],
    shares: [{ user_id: "u-alice", share_amount_cents: 1100 }],
    guest_shares: [],
    payers: [{ user_id: "u-alice", amount_cents: 1100 }],
    guests: [],
  };
}

function activeSingleAmount(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    expense_id: "exp-active-2",
    group_id: "grp-1",
    graph_revision: 7,
    title: "Shared",
    merchant_name: null,
    expense_type: "single_amount",
    total_amount: 1100,
    service_fee_basis_points: 0,
    fixed_fees: 0,
    items: [],
    item_ids: [],
    draft_claim_protected_user_ids: [],
    status: "active",
    participant_order: [{ kind: "user", user_id: "u-alice" }],
    shares: [{ user_id: "u-alice", share_amount_cents: 1100 }],
    guest_shares: [],
    payers: [{ user_id: "u-alice", amount_cents: 1100 }],
    guests: [],
    ...overrides,
  };
}

function okValue(result: SnapshotResult): DecodedExpenseGraphSnapshot {
  if (!result.ok) {
    throw new Error(`expected ok, got issue: ${JSON.stringify(result.issue)}`);
  }
  return result.value;
}

/** Assert the failure carries the given snapshot reason and (optionally) path. */
function expectSnapshotIssue(
  result: SnapshotResult,
  reason: "structure" | "identity" | "revision" | "status" | "allocation",
  path?: readonly (string | number)[],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issue.code).toBe("invalid_graph_snapshot");
  if (result.issue.code !== "invalid_graph_snapshot") return;
  expect(result.issue.reason).toBe(reason);
  if (path !== undefined) {
    expect(result.issue.path).toEqual(path);
  }
}

describe("decodeExpenseGraphSnapshot — valid snapshots", () => {
  it("decodes a single_amount draft (no items/fees, one user share/payer) to the draft arm", () => {
    const value = okValue(decodeExpenseGraphSnapshot(validDraft()));

    expect(value.status).toBe("draft");
    expect(value.expenseId).toBe("exp-draft-1");
    expect(value.groupId).toBe("grp-1");
    expect(value.graphRevision).toBe(5);
    expect(value.title).toBe("Dinner");
    expect(value.merchantName).toBeNull();
    expect(value.money.outcome).toBe("complete");
    expect(value.money.expenseType).toBe("single_amount");
    expect(value.money.totalAmountCents).toBe(1000);
    expect(value.money.items).toEqual([]);
    expect(value.itemIds).toEqual([]);
    expect(value.draftClaimProtectedUserIds).toEqual([]);
    expect(value.participantOrder).toEqual([
      { kind: "user", userId: "u-alice" },
    ]);
    expect(value.shares).toEqual([
      { userId: "u-alice", shareAmountCents: 1000 },
    ]);
    expect(value.guestShares).toEqual([]);
    expect(value.payers).toEqual([{ userId: "u-alice", amountCents: 1000 }]);
    expect(value.guests).toEqual([]);
  });

  it("decodes an itemized active snapshot (basis points, itemIds) to the active arm", () => {
    const value = okValue(decodeExpenseGraphSnapshot(validActive()));

    expect(value.status).toBe("active");
    expect(value.money.outcome).toBe("complete");
    if (value.money.outcome !== "complete") {
      throw new Error("expected complete money for active snapshot");
    }
    expect(value.money.expenseType).toBe("itemized");
    expect(value.money.totalAmountCents).toBe(1100);
    expect(value.money.summary).toEqual({
      itemsSubtotalCents: 1000,
      serviceFeeCents: 100,
      fixedFeesCents: 0,
      totalAmountCents: 1100,
    });
    // item ids are stripped from money.items and surfaced as itemIds.
    expect(value.itemIds).toEqual(["item-1"]);
    expect(value.money.items).toHaveLength(1);
    expect(value.money.items[0]).toEqual({
      description: "Burger",
      quantity: 1000, // 1.000 item -> 1000 milliunits
      unitPriceCents: 1000,
      totalPriceCents: 1000,
    });
    expect("id" in value.money.items[0]).toBe(false);
    // allocation summary is complete: shares and payers reconcile exactly.
    expect(value.allocations.shareState).toBe("exact");
    expect(value.allocations.payerState).toBe("exact");
    expect(value.allocations.completeness).toBe("complete");
  });
});

describe("decodeExpenseGraphSnapshot — structural rejections", () => {
  it("rejects a non-object root", () => {
    expect(decodeExpenseGraphSnapshot(null).ok).toBe(false);
    expect(decodeExpenseGraphSnapshot("x").ok).toBe(false);
    expect(decodeExpenseGraphSnapshot(42).ok).toBe(false);
  });

  it("rejects a missing root key (structure)", () => {
    const raw = validDraft();
    delete raw["status"];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "structure", [
      "status",
    ]);
  });

  it("rejects an extra root key (structure)", () => {
    const raw = validDraft();
    raw["unexpected"] = 1;
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "structure");
  });

  it("rejects an unknown status (status)", () => {
    const raw = validDraft();
    raw["status"] = "pending";
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "status", ["status"]);
  });

  it("rejects a bad graph revision (revision)", () => {
    const raw = validDraft();
    raw["graph_revision"] = -1;
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "revision", [
      "graph_revision",
    ]);
  });

  it("rejects service_fee_percent replacing the basis-points key (structure)", () => {
    const raw = validActive();
    delete raw["service_fee_basis_points"];
    raw["service_fee_percent"] = 10;
    expect(decodeExpenseGraphSnapshot(raw).ok).toBe(false);
  });

  it("rejects service_fee_percent even when basis_points is also present (extra key)", () => {
    const raw = validActive();
    raw["service_fee_percent"] = 10;
    expect(decodeExpenseGraphSnapshot(raw).ok).toBe(false);
  });
});

describe("decodeExpenseGraphSnapshot — item ids", () => {
  it("rejects an item_ids count mismatch", () => {
    const raw = validActive();
    raw["item_ids"] = ["item-1", "item-2"];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "structure", [
      "item_ids",
    ]);
  });

  it("rejects an item_ids order mismatch", () => {
    const raw = validActive();
    raw["item_ids"] = ["item-other"];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "structure", [
      "item_ids",
      0,
    ]);
  });

  it("rejects a duplicate item id", () => {
    const raw = validActive();
    const line = {
      id: "item-1",
      description: "Burger",
      quantity: 1,
      unit_price_cents: 1000,
      total_price_cents: 1000,
    };
    raw["items"] = [line, { ...line }];
    raw["item_ids"] = ["item-1", "item-1"];
    raw["total_amount"] = 2200;
    raw["shares"] = [{ user_id: "u-alice", share_amount_cents: 2200 }];
    raw["payers"] = [{ user_id: "u-alice", amount_cents: 2200 }];
    const result = decodeExpenseGraphSnapshot(raw);
    expect(result.ok).toBe(false);
    if (result.ok || result.issue.code !== "invalid_graph_snapshot") return;
    expect(result.issue.path).toContain(1);
  });

  it("rejects a blank item id", () => {
    const raw = validActive();
    raw["items"] = [
      {
        id: "",
        description: "Burger",
        quantity: 1,
        unit_price_cents: 1000,
        total_price_cents: 1000,
      },
    ];
    raw["item_ids"] = [""];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "structure", [
      "items",
      0,
      "id",
    ]);
  });
});

describe("decodeExpenseGraphSnapshot — identity rules", () => {
  it("rejects a payer that is not a current user participant (guests never pay)", () => {
    const raw = validActive();
    raw["payers"] = [{ user_id: "u-ghost", amount_cents: 1100 }];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "identity", [
      "payers",
      0,
    ]);
  });

  it("rejects a draft_claim_protected_user_id that is not a participant", () => {
    const raw = validDraft();
    raw["draft_claim_protected_user_ids"] = ["u-stranger"];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "identity", [
      "draft_claim_protected_user_ids",
    ]);
  });

  it("rejects draft_claim_protected_user_ids on an active snapshot", () => {
    const raw = validActive();
    raw["draft_claim_protected_user_ids"] = ["u-alice"];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "identity", [
      "draft_claim_protected_user_ids",
    ]);
  });

  it("accepts a draft_claim_protected_user_id that is a current user participant", () => {
    const raw = validDraft();
    raw["draft_claim_protected_user_ids"] = ["u-alice"];
    expect(decodeExpenseGraphSnapshot(raw).ok).toBe(true);
  });
});

describe("decodeExpenseGraphSnapshot — claim-aware participantOrder projection", () => {
  it("retains an unclaimed entity-backed guest in active participant order", () => {
    const raw = activeSingleAmount({
      participant_order: [
        { kind: "user", user_id: "u-alice" },
        { kind: "guest", guest_local_id: "g:1" },
      ],
      shares: [{ user_id: "u-alice", share_amount_cents: 550 }],
      guest_shares: [{ guest_local_id: "g:1", share_amount_cents: 550 }],
      guests: [
        {
          local_id: "g:1",
          display_name: "Plus one",
          original_share_amount_cents: 550,
          claimed_by_user_id: null,
          claimed_at: null,
        },
      ],
    });
    const value = okValue(decodeExpenseGraphSnapshot(raw));
    expect(value.participantOrder).toEqual([
      { kind: "user", userId: "u-alice" },
      { kind: "guest", guestLocalId: "g:1" },
    ]);
    expect(value.guests[0].claimedByUserId).toBeNull();
  });

  it("replaces a post-activation claimed guest with the claimant (case 2)", () => {
    const raw = activeSingleAmount({
      participant_order: [
        { kind: "user", user_id: "u-alice" },
        { kind: "guest", guest_local_id: "g:1" },
      ],
      // u-carol is the claimant; she holds the transferred share, no guest_share.
      shares: [
        { user_id: "u-alice", share_amount_cents: 550 },
        { user_id: "u-carol", share_amount_cents: 550 },
      ],
      guest_shares: [],
      payers: [{ user_id: "u-alice", amount_cents: 1100 }],
      guests: [
        {
          local_id: "g:1",
          display_name: "Future carol",
          original_share_amount_cents: 550,
          claimed_by_user_id: "u-carol",
          claimed_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const value = okValue(decodeExpenseGraphSnapshot(raw));
    expect(value.participantOrder).toEqual([
      { kind: "user", userId: "u-alice" },
      { kind: "user", userId: "u-carol" },
    ]);
    // The claimed guest remains as an audit row with its original amount.
    expect(value.guests).toHaveLength(1);
    expect(value.guests[0]).toMatchObject({
      guestLocalId: "g:1",
      claimedByUserId: "u-carol",
      originalShareAmountCents: 550,
    });
    expect(value.guestShares).toEqual([]);
  });

  it("folds a claimant that also appears later as a user into the guest slot", () => {
    const raw = activeSingleAmount({
      participant_order: [
        { kind: "user", user_id: "u-alice" },
        { kind: "guest", guest_local_id: "g:1" },
        { kind: "user", user_id: "u-carol" },
      ],
      shares: [
        { user_id: "u-alice", share_amount_cents: 550 },
        { user_id: "u-carol", share_amount_cents: 550 },
      ],
      guest_shares: [],
      payers: [{ user_id: "u-alice", amount_cents: 1100 }],
      guests: [
        {
          local_id: "g:1",
          display_name: "Future carol",
          original_share_amount_cents: 550,
          claimed_by_user_id: "u-carol",
          claimed_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const value = okValue(decodeExpenseGraphSnapshot(raw));
    // u-carol appears once, at the guest's slot; the later user entity is dropped.
    expect(value.participantOrder).toEqual([
      { kind: "user", userId: "u-alice" },
      { kind: "user", userId: "u-carol" },
    ]);
  });

  it("folds a post-activation claimed guest into an earlier claimant slot (case 2)", () => {
    const raw = activeSingleAmount({
      participant_order: [
        { kind: "user", user_id: "u-carol" },
        { kind: "user", user_id: "u-alice" },
        { kind: "guest", guest_local_id: "g:1" },
      ],
      shares: [
        { user_id: "u-carol", share_amount_cents: 550 },
        { user_id: "u-alice", share_amount_cents: 550 },
      ],
      guest_shares: [],
      payers: [{ user_id: "u-alice", amount_cents: 1100 }],
      guests: [
        {
          local_id: "g:1",
          display_name: "Future carol",
          original_share_amount_cents: 550,
          claimed_by_user_id: "u-carol",
          claimed_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const value = okValue(decodeExpenseGraphSnapshot(raw));
    // u-carol already holds an earlier slot, so g:1 folds away; order is preserved.
    expect(value.participantOrder).toEqual([
      { kind: "user", userId: "u-carol" },
      { kind: "user", userId: "u-alice" },
    ]);
  });

  it("rejects a claimed guest on a draft (case 1 must be hidden)", () => {
    const raw = validDraft();
    raw["participant_order"] = [
      { kind: "user", user_id: "u-alice" },
      { kind: "guest", guest_local_id: "g:1" },
    ];
    raw["shares"] = [
      { user_id: "u-alice", share_amount_cents: 500 },
      { user_id: "u-carol", share_amount_cents: 500 },
    ];
    raw["guest_shares"] = [];
    raw["guests"] = [
      {
        local_id: "g:1",
        display_name: "Claimed early",
        original_share_amount_cents: 500,
        claimed_by_user_id: "u-carol",
        claimed_at: "2024-01-01T00:00:00Z",
      },
    ];
    expectSnapshotIssue(decodeExpenseGraphSnapshot(raw), "identity", ["guests"]);
  });
});

describe("decodeExpenseGraphSnapshot — immutability", () => {
  it("returns a recursively frozen decoded value and never mutates input", () => {
    const raw = validActive();
    const value = okValue(decodeExpenseGraphSnapshot(raw));
    if (value.money.outcome !== "complete") {
      throw new Error("expected complete money for active snapshot");
    }

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.money)).toBe(true);
    expect(Object.isFrozen(value.money.items)).toBe(true);
    expect(Object.isFrozen(value.money.items[0])).toBe(true);
    expect(Object.isFrozen(value.money.summary)).toBe(true);
    expect(Object.isFrozen(value.itemIds)).toBe(true);
    expect(Object.isFrozen(value.draftClaimProtectedUserIds)).toBe(true);
    expect(Object.isFrozen(value.participantOrder)).toBe(true);
    expect(Object.isFrozen(value.shares)).toBe(true);
    expect(Object.isFrozen(value.shares[0])).toBe(true);
    expect(Object.isFrozen(value.guestShares)).toBe(true);
    expect(Object.isFrozen(value.payers)).toBe(true);
    expect(Object.isFrozen(value.payers[0])).toBe(true);
    expect(Object.isFrozen(value.guests)).toBe(true);
    expect(Object.isFrozen(value.allocations)).toBe(true);
    expect(Object.isFrozen(value.allocations.participantOrder)).toBe(true);

    // The input fixture is untouched (not frozen, not aliased into the output).
    expect(Object.isFrozen(raw)).toBe(false);
  });
});
