import { describe, expect, it } from "vitest";
import {
  ROOM_TICKS_PER_MILLIUNIT,
  allocateAssignmentItemCents,
  buildAssignmentDivision,
  buildAssignmentExpense,
  claimTicksForFraction,
  claimTicksForQuantity,
} from "@/lib/assignment-room-money";
import { MAX_EXPENSE_CENTS } from "@/lib/expense-money";
import type {
  AssignmentRoomParticipant,
  AssignmentRoomSnapshot,
  AssignmentRoomView,
} from "@/types/assignment-room";
import type {
  ExpensePayerPayload,
  ExpensePayload,
} from "@/types/ledger";

type HostView = Extract<AssignmentRoomView, { role: "host" }>;

const ROOM_ID = "9f1c3a2e-0000-4000-8000-000000000001";
const HOST_ID = "9f1c3a2e-0000-4000-8000-000000000002";
const BRUNO_ID = "9f1c3a2e-0000-4000-8000-000000000003";
const CIRO_ID = "9f1c3a2e-0000-4000-8000-000000000004";
const DUDA_ID = "9f1c3a2e-0000-4000-8000-000000000005";
const REMOVED_ID = "9f1c3a2e-0000-4000-8000-000000000006";
const ITEM_ID = "9f1c3a2e-0000-4000-8000-0000000000aa";
const ITEM_X_ID = "9f1c3a2e-0000-4000-8000-0000000000bb";
const ITEM_Y_ID = "9f1c3a2e-0000-4000-8000-0000000000cc";
const USER_ANA = "7e100000-0000-4000-8000-000000000001";
const USER_BRUNO = "7e100000-0000-4000-8000-000000000002";
const USER_DUDA = "7e100000-0000-4000-8000-000000000003";

const USER_REFS: HostView["participantRefs"] = [
  { participantId: HOST_ID, ref: { kind: "user", userId: USER_ANA } },
  { participantId: BRUNO_ID, ref: { kind: "user", userId: USER_BRUNO } },
];

function participant(
  id: string,
  ordinal: number,
  overrides: Partial<AssignmentRoomParticipant> = {},
): AssignmentRoomParticipant {
  return {
    id,
    ordinal,
    displayName: `Pessoa ${ordinal}`,
    avatarUrl: null,
    isGuest: false,
    removed: false,
    ...overrides,
  };
}

/**
 * The deterministic fee-parity fixture: one 100-cent line claimed in exact
 * thirds, 10% service fee, 1-cent fixed fee. Item 34/33/33, service 4/3/3,
 * fixed 1/0/0, final 39/36/36 = 111 cents.
 */
function parityRoom(): AssignmentRoomSnapshot {
  return {
    id: ROOM_ID,
    revision: 7,
    status: "closed",
    title: "Bar do Zé",
    occurredOn: "2026-09-19",
    serviceFeeBasisPoints: 1000,
    fixedFeeCents: 1,
    totalCents: 111,
    selfParticipantId: HOST_ID,
    items: [
      {
        id: ITEM_ID,
        ordinal: 0,
        revision: 3,
        description: "Porção",
        quantityMilliunits: 1000,
        unitPriceCents: 100,
        totalPriceCents: 100,
      },
    ],
    participants: [
      participant(HOST_ID, 0, { displayName: "Ana" }),
      participant(BRUNO_ID, 1, { displayName: "Bruno" }),
      participant(CIRO_ID, 2, { displayName: "Ciro", isGuest: true }),
    ],
    claims: [
      { itemId: ITEM_ID, participantId: HOST_ID, ticks: 40_000 },
      { itemId: ITEM_ID, participantId: BRUNO_ID, ticks: 40_000 },
      { itemId: ITEM_ID, participantId: CIRO_ID, ticks: 40_000 },
    ],
    topic: "assignment-room:9f1c3a2e",
    currentBill: null,
  };
}

function hostView(
  room: AssignmentRoomSnapshot,
  participantRefs: HostView["participantRefs"] = [],
): HostView {
  return {
    role: "host",
    room,
    groupTarget: { kind: "new", name: "Role de sexta" },
    participantRefs,
  };
}

function buildOk(view: HostView, payers: readonly ExpensePayerPayload[]): ExpensePayload {
  const result = buildAssignmentExpense(view, payers);
  if (!result.ok) {
    throw new Error(`fixture: build failed with ${result.issue.code}`);
  }
  return result.value;
}

describe("claimTicksForQuantity", () => {
  it("converts milliunits to ticks exactly", () => {
    expect(claimTicksForQuantity(1)).toEqual({
      ok: true,
      value: ROOM_TICKS_PER_MILLIUNIT,
    });
    expect(claimTicksForQuantity(1_000)).toEqual({ ok: true, value: 120_000 });
  });

  it("keeps the maximum quantity below the safe-integer bound", () => {
    expect(claimTicksForQuantity(999_999_999)).toEqual({
      ok: true,
      value: 119_999_999_880,
    });
    expect(Number.isSafeInteger(119_999_999_880)).toBe(true);
  });

  it("rejects zero, negative, fractional, and nonfinite quantities", () => {
    for (const bad of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(claimTicksForQuantity(bad).ok).toBe(false);
    }
  });

  it("rejects quantities above the representable bound", () => {
    expect(claimTicksForQuantity(1_000_000_000).ok).toBe(false);
    expect(claimTicksForQuantity(Number.MAX_SAFE_INTEGER).ok).toBe(false);
  });
});

describe("claimTicksForFraction", () => {
  it("gives two of three equal beers exactly two thirds of the quantity", () => {
    expect(claimTicksForFraction(3_000, 2, 3)).toEqual({
      ok: true,
      value: 240_000,
    });
  });

  it("is exact for every allowed denominator", () => {
    for (const denominator of [1, 2, 3, 4, 5, 6, 8, 10]) {
      expect(claimTicksForFraction(1_000, 1, denominator)).toEqual({
        ok: true,
        value: 1_000 * (ROOM_TICKS_PER_MILLIUNIT / denominator),
      });
    }
  });

  it("keeps the maximum fraction below the safe-integer bound", () => {
    expect(claimTicksForFraction(999_999_999, 1, 3)).toEqual({
      ok: true,
      value: 39_999_999_960,
    });
  });

  it("allows a zero numerator as a null claim", () => {
    expect(claimTicksForFraction(1_000, 0, 3)).toEqual({ ok: true, value: 0 });
  });

  it("rejects unsupported denominators", () => {
    for (const denominator of [0, 7, 9, -2, 2.5]) {
      expect(claimTicksForFraction(1_000, 1, denominator).ok).toBe(false);
    }
  });

  it("rejects excess fractions, negative numerators, and bad quantities", () => {
    expect(claimTicksForFraction(1_000, 4, 3).ok).toBe(false);
    expect(claimTicksForFraction(1_000, -1, 3).ok).toBe(false);
    expect(claimTicksForFraction(0, 1, 3).ok).toBe(false);
    expect(claimTicksForFraction(-500, 1, 3).ok).toBe(false);
  });
});

describe("allocateAssignmentItemCents", () => {
  const oneThirdClaims = [
    { participantId: "p-h", ordinal: 0, ticks: 40_000 },
    { participantId: "p-1", ordinal: 1, ticks: 40_000 },
    { participantId: "p-2", ordinal: 2, ticks: 40_000 },
  ];

  const expectedThirds = [
    { participantId: "p-h", amountCents: 334 },
    { participantId: "p-1", amountCents: 333 },
    { participantId: "p-2", amountCents: 333 },
  ];

  it("allocates 334/333/333 in ordinal order for three one-third claims", () => {
    expect(allocateAssignmentItemCents(1_000, oneThirdClaims)).toEqual({
      ok: true,
      value: expectedThirds,
    });
  });

  it("sorts shuffled input into ordinal order", () => {
    const shuffled = [...oneThirdClaims].reverse();
    expect(allocateAssignmentItemCents(1_000, shuffled)).toEqual({
      ok: true,
      value: expectedThirds,
    });
  });

  it("gives a two-thirds claim exactly two thirds of the line cents", () => {
    expect(
      allocateAssignmentItemCents(900, [
        { participantId: "a", ordinal: 0, ticks: 240_000 },
        { participantId: "b", ordinal: 1, ticks: 60_000 },
        { participantId: "c", ordinal: 2, ticks: 60_000 },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { participantId: "a", amountCents: 600 },
        { participantId: "b", amountCents: 150 },
        { participantId: "c", amountCents: 150 },
      ],
    });
  });

  it("applies no monetary-weight cap to ticks", () => {
    // The maximum tick weight exceeds the per-expense cent cap on purpose.
    expect(
      allocateAssignmentItemCents(MAX_EXPENSE_CENTS as number, [
        { participantId: "solo", ordinal: 0, ticks: 119_999_999_880 },
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          participantId: "solo",
          amountCents: MAX_EXPENSE_CENTS as number,
        },
      ],
    });
  });

  it("breaks remainder ties by ascending ordinal", () => {
    expect(
      allocateAssignmentItemCents(1, [
        { participantId: "second", ordinal: 1, ticks: 40_000 },
        { participantId: "first", ordinal: 0, ticks: 40_000 },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { participantId: "first", amountCents: 1 },
        { participantId: "second", amountCents: 0 },
      ],
    });
  });

  it("returns an explicit zero vector for a zero-cent line", () => {
    const result = allocateAssignmentItemCents(0, oneThirdClaims);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((row) => row.participantId)).toEqual([
        "p-h",
        "p-1",
        "p-2",
      ]);
      expect(result.value.map((row) => row.amountCents)).toEqual([0, 0, 0]);
    }
  });

  it("fails explicitly instead of rounding on invalid input", () => {
    expect(allocateAssignmentItemCents(1_000, []).ok).toBe(false);
    expect(allocateAssignmentItemCents(-1, oneThirdClaims).ok).toBe(false);
    expect(
      allocateAssignmentItemCents(Number.NaN, oneThirdClaims).ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents((MAX_EXPENSE_CENTS as number) + 1, oneThirdClaims)
        .ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents(1_000, [
        { participantId: "a", ordinal: 0, ticks: -1 },
        { participantId: "b", ordinal: 1, ticks: 40_001 },
      ]).ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents(1_000, [
        { participantId: "a", ordinal: 0, ticks: 0.5 },
        { participantId: "b", ordinal: 1, ticks: 40_000 },
      ]).ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents(1_000, [
        { participantId: "a", ordinal: 0, ticks: 119_999_999_881 },
        { participantId: "b", ordinal: 1, ticks: 1 },
      ]).ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents(1_000, [
        { participantId: "a", ordinal: 0, ticks: 40_000 },
        { participantId: "a", ordinal: 1, ticks: 40_000 },
      ]).ok,
    ).toBe(false);
    expect(
      allocateAssignmentItemCents(1_000, [
        { participantId: "a", ordinal: 0, ticks: 0 },
        { participantId: "b", ordinal: 1, ticks: 0 },
      ]).ok,
    ).toBe(false);
  });
});

describe("buildAssignmentExpense", () => {
  it("materializes the exact fee-parity breakdown for thirds with fees", () => {
    const payload = buildOk(hostView(parityRoom(), USER_REFS), [
      { participantIndex: 0, amountCents: 111 },
    ]);
    expect(payload.items).toEqual([
      {
        description: "Porção",
        quantityMilliunits: 1_000,
        unitPriceCents: 100,
        totalPriceCents: 100,
      },
    ]);
    expect(payload.itemAssignments).toEqual([
      { itemIndex: 0, participantIndex: 0, amountCents: 34 },
      { itemIndex: 0, participantIndex: 1, amountCents: 33 },
      { itemIndex: 0, participantIndex: 2, amountCents: 33 },
    ]);
    // Service fee 4/3/3 on the 34/33/33 item weights, fixed fee 1/0/0.
    expect(payload.shares).toEqual([39, 36, 36]);
    expect(payload.participants).toEqual([
      { kind: "user", userId: USER_ANA },
      { kind: "user", userId: USER_BRUNO },
      { kind: "guest", guestId: null, displayName: "Ciro" },
    ]);
    expect(payload.payers).toEqual([{ participantIndex: 0, amountCents: 111 }]);
    expect(payload.splitMethod).toBeNull();
    expect(payload.shares.reduce((sum, cents) => sum + cents, 0)).toBe(111);
  });

  it("orders participants and items by ordinal and omits removed participants", () => {
    const room: AssignmentRoomSnapshot = {
      ...parityRoom(),
      serviceFeeBasisPoints: 0,
      totalCents: 600,
      fixedFeeCents: 0,
      items: [
        {
          id: ITEM_X_ID,
          ordinal: 1,
          revision: 2,
          description: "Porção",
          quantityMilliunits: 1_000,
          unitPriceCents: 100,
          totalPriceCents: 100,
        },
        {
          id: ITEM_Y_ID,
          ordinal: 0,
          revision: 1,
          description: "Salada",
          quantityMilliunits: 500,
          unitPriceCents: 1_000,
          totalPriceCents: 500,
        },
      ],
      participants: [
        participant(HOST_ID, 2, { displayName: "Ana" }),
        participant(REMOVED_ID, 1, { displayName: "Saiu", removed: true }),
        participant(BRUNO_ID, 3, { displayName: "Bruno" }),
        participant(DUDA_ID, 0, { displayName: "Duda" }),
        participant(CIRO_ID, 5, { displayName: "Ciro", isGuest: true }),
      ],
      claims: [
        { itemId: ITEM_X_ID, participantId: HOST_ID, ticks: 40_000 },
        { itemId: ITEM_X_ID, participantId: DUDA_ID, ticks: 40_000 },
        { itemId: ITEM_X_ID, participantId: BRUNO_ID, ticks: 40_000 },
        // Stale claim of the removed participant; the survivors cover the line.
        { itemId: ITEM_X_ID, participantId: REMOVED_ID, ticks: 40_000 },
        { itemId: ITEM_Y_ID, participantId: BRUNO_ID, ticks: 60_000 },
      ],
    };
    const payload = buildOk(
      hostView(room, [
        { participantId: HOST_ID, ref: { kind: "user", userId: USER_ANA } },
        { participantId: BRUNO_ID, ref: { kind: "user", userId: USER_BRUNO } },
        { participantId: DUDA_ID, ref: { kind: "user", userId: USER_DUDA } },
      ]),
      [{ participantIndex: 2, amountCents: 600 }],
    );
    expect(payload.items.map((item) => item.description)).toEqual([
      "Salada",
      "Porção",
    ]);
    expect(payload.participants).toEqual([
      { kind: "user", userId: USER_DUDA },
      { kind: "user", userId: USER_ANA },
      { kind: "user", userId: USER_BRUNO },
      { kind: "guest", guestId: null, displayName: "Ciro" },
    ]);
    expect(payload.itemAssignments).toEqual([
      { itemIndex: 0, participantIndex: 2, amountCents: 500 },
      { itemIndex: 1, participantIndex: 0, amountCents: 34 },
      { itemIndex: 1, participantIndex: 1, amountCents: 33 },
      { itemIndex: 1, participantIndex: 2, amountCents: 33 },
    ]);
    expect(payload.shares).toEqual([34, 33, 533, 0]);
    expect(payload.payers).toEqual([{ participantIndex: 2, amountCents: 600 }]);
  });

  it("keeps the host in the participant list at zero consumption", () => {
    const room = parityRoom();
    room.serviceFeeBasisPoints = 0;
    room.fixedFeeCents = 2;
    room.totalCents = 102;
    room.claims = [
      { itemId: ITEM_ID, participantId: BRUNO_ID, ticks: 60_000 },
      { itemId: ITEM_ID, participantId: CIRO_ID, ticks: 60_000 },
    ];
    const payload = buildOk(hostView(room, USER_REFS), [
      { participantIndex: 1, amountCents: 102 },
    ]);
    expect(payload.participants).toEqual([
      { kind: "user", userId: USER_ANA },
      { kind: "user", userId: USER_BRUNO },
      { kind: "guest", guestId: null, displayName: "Ciro" },
    ]);
    expect(payload.itemAssignments).toEqual([
      { itemIndex: 0, participantIndex: 1, amountCents: 50 },
      { itemIndex: 0, participantIndex: 2, amountCents: 50 },
    ]);
    // The host takes no item cents but still receives a fixed-fee cent.
    expect(payload.shares).toEqual([1, 51, 50]);
  });

  it("rejects a zero-cent final expense", () => {
    const room = parityRoom();
    room.serviceFeeBasisPoints = 0;
    room.fixedFeeCents = 0;
    room.totalCents = 0;
    room.items = [
      {
        id: ITEM_ID,
        ordinal: 0,
        revision: 1,
        description: "Cortesia",
        quantityMilliunits: 1_000,
        unitPriceCents: 0,
        totalPriceCents: 0,
      },
    ];
    expect(buildAssignmentExpense(hostView(room, USER_REFS), []).ok).toBe(false);
  });

  it("rejects a guest payer", () => {
    expect(
      buildAssignmentExpense(hostView(parityRoom(), USER_REFS), [
        { participantIndex: 2, amountCents: 111 },
      ]).ok,
    ).toBe(false);
  });

  it("rejects a payer without a registered user ref", () => {
    expect(
      buildAssignmentExpense(hostView(parityRoom()), [
        { participantIndex: 0, amountCents: 111 },
      ]).ok,
    ).toBe(false);
  });

  it("rejects out-of-range payer indexes and off-total payer sums", () => {
    expect(
      buildAssignmentExpense(hostView(parityRoom(), USER_REFS), [
        { participantIndex: 3, amountCents: 111 },
      ]).ok,
    ).toBe(false);
    expect(
      buildAssignmentExpense(hostView(parityRoom(), USER_REFS), [
        { participantIndex: 0, amountCents: 110 },
      ]).ok,
    ).toBe(false);
  });

  it("rejects zero-valued payers", () => {
    expect(
      buildAssignmentExpense(hostView(parityRoom(), USER_REFS), [
        { participantIndex: 0, amountCents: 111 },
        { participantIndex: 1, amountCents: 0 },
      ]).ok,
    ).toBe(false);
  });

  it("fails on incomplete capacity instead of rounding", () => {
    const room = parityRoom();
    room.claims = room.claims.slice(0, 2);
    expect(
      buildAssignmentExpense(hostView(room, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("fails on overclaimed capacity instead of normalizing", () => {
    const room = parityRoom();
    room.claims = [
      { itemId: ITEM_ID, participantId: HOST_ID, ticks: 60_000 },
      { itemId: ITEM_ID, participantId: BRUNO_ID, ticks: 40_000 },
      { itemId: ITEM_ID, participantId: CIRO_ID, ticks: 40_000 },
    ];
    expect(
      buildAssignmentExpense(hostView(room, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("requires a closed room with no finalized bill", () => {
    const openRoom = parityRoom();
    openRoom.status = "open";
    expect(buildAssignmentExpense(hostView(openRoom, USER_REFS), []).ok).toBe(
      false,
    );

    const finalizedRoom = parityRoom();
    finalizedRoom.status = "finalized";
    finalizedRoom.currentBill = {
      status: "active",
      versionNo: 1,
      title: finalizedRoom.title,
      occurredOn: finalizedRoom.occurredOn,
      items: [],
      itemAssignments: [],
      participants: [],
      shares: [],
      payers: [],
      totalCents: finalizedRoom.totalCents,
      serviceFeeBasisPoints: finalizedRoom.serviceFeeBasisPoints,
      fixedFeeCents: finalizedRoom.fixedFeeCents,
    };
    expect(
      buildAssignmentExpense(hostView(finalizedRoom, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("fails when a removed participant's stale claim leaves capacity uncovered", () => {
    const room = parityRoom();
    room.participants = [
      ...room.participants,
      participant(REMOVED_ID, 3, { displayName: "Saiu", removed: true }),
    ];
    room.claims = [
      { itemId: ITEM_ID, participantId: HOST_ID, ticks: 40_000 },
      { itemId: ITEM_ID, participantId: BRUNO_ID, ticks: 40_000 },
      { itemId: ITEM_ID, participantId: REMOVED_ID, ticks: 120_000 },
    ];
    expect(
      buildAssignmentExpense(hostView(room, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("fails on claims from unknown participants or unknown items", () => {
    const unknownClaimant = parityRoom();
    unknownClaimant.claims = [
      ...unknownClaimant.claims,
      {
        itemId: ITEM_ID,
        participantId: "9f1c3a2e-0000-4000-8000-00000000dead",
        ticks: 1,
      },
    ];
    expect(
      buildAssignmentExpense(hostView(unknownClaimant, USER_REFS), []).ok,
    ).toBe(false);
    const unknownItem = parityRoom();
    unknownItem.claims = [
      ...unknownItem.claims,
      {
        itemId: "9f1c3a2e-0000-4000-8000-00000000beef",
        participantId: HOST_ID,
        ticks: 1,
      },
    ];
    expect(
      buildAssignmentExpense(hostView(unknownItem, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("fails when the host is not an active participant", () => {
    const room = parityRoom();
    room.selfParticipantId = REMOVED_ID;
    expect(
      buildAssignmentExpense(hostView(room, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("rejects duplicate identities, ordinals, and unsafe ordinals", () => {
    const duplicateParticipant = parityRoom();
    duplicateParticipant.participants[1] = {
      ...duplicateParticipant.participants[1],
      id: duplicateParticipant.participants[0].id,
    };
    expect(
      buildAssignmentExpense(hostView(duplicateParticipant, USER_REFS), []).ok,
    ).toBe(false);

    const duplicateItemOrdinal = parityRoom();
    duplicateItemOrdinal.items.push({
      ...duplicateItemOrdinal.items[0],
      id: ITEM_X_ID,
    });
    expect(
      buildAssignmentExpense(hostView(duplicateItemOrdinal, USER_REFS), []).ok,
    ).toBe(false);

    const unsafeOrdinal = parityRoom();
    unsafeOrdinal.participants[0] = {
      ...unsafeOrdinal.participants[0],
      ordinal: Number.MAX_SAFE_INTEGER + 1,
    };
    expect(
      buildAssignmentExpense(hostView(unsafeOrdinal, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("rejects an empty item collection and item counts beyond the bound", () => {
    const empty = parityRoom();
    empty.items = [];
    expect(buildAssignmentExpense(hostView(empty, USER_REFS), []).ok).toBe(
      false,
    );
    const tooMany = parityRoom();
    tooMany.items = Array.from({ length: 101 }, (_, i) => ({
      id: `9f1c3a2e-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ordinal: i,
      revision: 1,
      description: `Item ${i}`,
      quantityMilliunits: 1,
      unitPriceCents: 1,
      totalPriceCents: 1,
    }));
    expect(buildAssignmentExpense(hostView(tooMany, USER_REFS), []).ok).toBe(
      false,
    );
  });

  it("rejects out-of-range fee configuration and item cents", () => {
    const badRate = parityRoom();
    badRate.serviceFeeBasisPoints = 10_001;
    expect(buildAssignmentExpense(hostView(badRate, USER_REFS), []).ok).toBe(
      false,
    );
    const badFixed = parityRoom();
    badFixed.fixedFeeCents = -1;
    expect(buildAssignmentExpense(hostView(badFixed, USER_REFS), []).ok).toBe(
      false,
    );
    const badItemTotal = parityRoom();
    badItemTotal.items = [
      { ...badItemTotal.items[0], totalPriceCents: -5 },
    ];
    expect(
      buildAssignmentExpense(hostView(badItemTotal, USER_REFS), []).ok,
    ).toBe(false);
  });

  it("rejects inconsistent line and room totals", () => {
    const badLine = parityRoom();
    badLine.items[0] = { ...badLine.items[0], unitPriceCents: 99 };
    expect(buildAssignmentExpense(hostView(badLine, USER_REFS), []).ok).toBe(
      false,
    );

    const badRoomTotal = parityRoom();
    badRoomTotal.totalCents = 110;
    expect(
      buildAssignmentExpense(hostView(badRoomTotal, USER_REFS), []).ok,
    ).toBe(false);
  });
});

describe("buildAssignmentDivision", () => {
  it("previews the exact division with no payers attached", () => {
    const view = hostView(parityRoom(), USER_REFS);
    const division = buildAssignmentDivision(view);
    expect(division.ok).toBe(true);
    if (!division.ok) {
      return;
    }
    expect(division.value.payers).toEqual([]);
    const payload = buildOk(view, [{ participantIndex: 0, amountCents: 111 }]);
    expect(division.value).toEqual({ ...payload, payers: [] });
  });

  it("fails before payers exactly where buildAssignmentExpense fails", () => {
    const openRoom = parityRoom();
    openRoom.status = "open";
    expect(buildAssignmentDivision(hostView(openRoom, USER_REFS))).toEqual(
      buildAssignmentExpense(hostView(openRoom, USER_REFS), []),
    );
    const shortLine = parityRoom();
    shortLine.claims = shortLine.claims.slice(0, 2);
    expect(buildAssignmentDivision(hostView(shortLine, USER_REFS))).toEqual(
      buildAssignmentExpense(hostView(shortLine, USER_REFS), []),
    );
  });
});
