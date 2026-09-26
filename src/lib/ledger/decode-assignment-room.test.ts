import { describe, expect, it } from "vitest";
import {
  decodeAnnounceAssignmentRoomResult,
  decodeAssignmentRoomCompletion,
  decodeAssignmentRoomSummary,
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
  decodeOpenAssignmentRooms,
} from "./decode-assignment-room";

const ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000003";

function room() {
  return {
    id: ID,
    revision: 4,
    status: "open",
    title: "Almoço",
    occurredOn: "2026-09-19",
    serviceFeeBasisPoints: 1_000,
    fixedFeeCents: 1,
    totalCents: 111,
    selfParticipantId: PARTICIPANT_ID,
    items: [
      {
        id: ITEM_ID,
        ordinal: 0,
        revision: 2,
        description: "Prato",
        quantityMilliunits: 1_000,
        unitPriceCents: 100,
        totalPriceCents: 100,
      },
    ],
    participants: [
      {
        id: PARTICIPANT_ID,
        ordinal: 0,
        displayName: "Ana",
        avatarUrl: null,
        isGuest: false,
        removed: false,
      },
    ],
    claims: [{ itemId: ITEM_ID, participantId: PARTICIPANT_ID, ticks: 120_000 }],
    topic: `assignment:${ID}:${"A".repeat(43)}`,
    currentBill: null,
  };
}

function hostView() {
  return {
    role: "host",
    room: room(),
    groupTarget: { kind: "new", name: "Conta compartilhada" },
    participantRefs: [
      {
        participantId: PARTICIPANT_ID,
        ref: { kind: "user", userId: ID },
      },
    ],
  };
}

describe("decodeAssignmentRoomView", () => {
  it("decodes the complete role-scoped host view", () => {
    const decoded = decodeAssignmentRoomView(hostView());
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.role).toBe("host");
      expect(decoded.value.room.revision).toBe(4);
    }
  });

  it("rejects host-only fields on a participant view", () => {
    const raw = {
      role: "participant",
      room: room(),
      participantRefs: [],
    };
    const decoded = decodeAssignmentRoomView(raw);
    expect(decoded).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["participantRefs"] },
    });
  });

  it("rejects malformed nested bill data", () => {
    const raw = hostView();
    raw.room.currentBill = {
      status: "active",
      versionNo: 1,
      title: "Almoço",
      occurredOn: "2026-09-19",
      items: [],
      itemAssignments: null,
      participants: [],
      shares: [111.5],
      payers: [],
      totalCents: 111,
      serviceFeeBasisPoints: 1_000,
      fixedFeeCents: 1,
    } as never;
    const decoded = decodeAssignmentRoomView(raw);
    expect(decoded).toMatchObject({
      ok: false,
      issue: { path: ["room", "currentBill", "shares", 0] },
    });
  });

  it("decodes a finalize response through room and ack contracts", () => {
    const decoded = decodeFinalizeAssignmentRoomResult({
      room: hostView(),
      ack: {
        groupId: ID,
        expenseId: ITEM_ID,
        versionNo: 1,
        ledgerVersion: 3,
        eventId: 9,
      },
    });
    expect(decoded).toMatchObject({
      ok: true,
      value: {
        room: { role: "host" },
        ack: { groupId: ID, expenseId: ITEM_ID, versionNo: 1 },
      },
    });
  });
});

function completion(action: unknown = { kind: "sign_in" }) {
  return {
    roomId: ID,
    bill: {
      status: "active",
      versionNo: 1,
      title: "Almoço",
      occurredOn: "2026-09-19",
      items: [
        {
          description: "Prato",
          quantityMilliunits: 1_000,
          unitPriceCents: 100,
          totalPriceCents: 100,
        },
      ],
      itemAssignments: null,
      participants: [
        {
          participantIndex: 0,
          displayName: "Ana",
          avatarUrl: null,
          isGuest: false,
        },
      ],
      shares: [111],
      payers: [],
      totalCents: 111,
      serviceFeeBasisPoints: 1_000,
      fixedFeeCents: 1,
    },
    selfParticipantIndex: 0 as number | null,
    action,
  };
}

describe("decodeAssignmentRoomCompletion", () => {
  it("decodes a signed-in account action with its stable index", () => {
    const decoded = decodeAssignmentRoomCompletion(
      completion({ kind: "view_expense", expenseId: ITEM_ID, groupId: ID }),
    );
    expect(decoded).toMatchObject({
      ok: true,
      value: {
        roomId: ID,
        selfParticipantIndex: 0,
        action: { kind: "view_expense", expenseId: ITEM_ID, groupId: ID },
      },
    });
  });

  it("accepts a null index for a deleted or unmapped bill", () => {
    const raw = completion({ kind: "unavailable" });
    raw.selfParticipantIndex = null;
    const decoded = decodeAssignmentRoomCompletion(raw);
    expect(decoded).toMatchObject({
      ok: true,
      value: { selfParticipantIndex: null, action: { kind: "unavailable" } },
    });
  });

  it("rejects action fields that are not allowed for their kind", () => {
    const decoded = decodeAssignmentRoomCompletion(
      completion({ kind: "sign_in", groupId: ID }),
    );
    expect(decoded).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["action", "groupId"] },
    });
  });
});

function roomSummary(): Record<string, unknown> {
  return {
    id: ID,
    groupId: ID,
    status: "open",
    revision: 4,
    title: "Almoço",
    occurredOn: "2026-09-19",
    totalCents: 111,
    host: { id: ID, handle: "ana", name: "Ana", avatarUrl: null, isBot: false },
    createdAt: "2026-09-19T12:00:00.000Z",
    itemCount: 3,
    ownedItemCount: 1,
    claimers: [
      { participantId: ID, userId: ID, name: "Ana", avatarUrl: "https://example.test/ana.png" },
      { participantId: ID, userId: null, name: "Convidado", avatarUrl: null },
    ],
    expenseId: null,
  };
}

function openRoom(): Record<string, unknown> {
  return { ...roomSummary(), joined: false };
}

describe("decodeAssignmentRoomSummary", () => {
  it("decodes account and guest claimers", () => {
    expect(decodeAssignmentRoomSummary(roomSummary())).toMatchObject({
      ok: true,
      value: roomSummary(),
    });
  });

  it("rejects a claimer with an unknown key", () => {
    const summary = roomSummary();
    summary.claimers = [{ participantId: ID, userId: null, name: "Bia", avatarUrl: null, ticks: 1 }];
    expect(decodeAssignmentRoomSummary(summary)).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["claimers", 0, "ticks"] },
    });
  });

  it("rejects an unknown status", () => {
    expect(decodeAssignmentRoomSummary({ ...roomSummary(), status: "draft" })).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["status"] },
    });
  });

  it("rejects the viewer-specific joined flag", () => {
    expect(decodeAssignmentRoomSummary(openRoom())).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["joined"] },
    });
  });
});

describe("decodeOpenAssignmentRooms", () => {
  it("decodes every entry as a summary plus joined", () => {
    const decoded = decodeOpenAssignmentRooms({ rooms: [openRoom()] });
    expect(decoded).toMatchObject({ ok: true, value: [openRoom()] });
  });

  it("rejects an entry with an unknown key", () => {
    const decoded = decodeOpenAssignmentRooms({ rooms: [{ ...openRoom(), hostId: ID }] });
    expect(decoded).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["rooms", 0, "hostId"] },
    });
  });

  it("rejects an entry with a missing key", () => {
    const entry = openRoom();
    delete entry.joined;
    const decoded = decodeOpenAssignmentRooms({ rooms: [entry] });
    expect(decoded).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["rooms", 0, "joined"] },
    });
  });

  it("rejects a negative, fractional or unsafe total", () => {
    for (const totalCents of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const decoded = decodeOpenAssignmentRooms({
        rooms: [{ ...openRoom(), totalCents }],
      });
      expect(decoded).toMatchObject({
        ok: false,
        issue: { code: "invalid_wire", path: ["rooms", 0, "totalCents"] },
      });
    }
  });

  it("rejects unknown root keys", () => {
    const decoded = decodeOpenAssignmentRooms({ rooms: [], nextCursor: null });
    expect(decoded).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["nextCursor"] },
    });
  });
});

describe("decodeAnnounceAssignmentRoomResult", () => {
  it("decodes the event id", () => {
    const decoded = decodeAnnounceAssignmentRoomResult({ eventId: 9 });
    expect(decoded).toMatchObject({ ok: true, value: { eventId: 9 } });
  });

  it("rejects unknown or missing keys", () => {
    expect(decodeAnnounceAssignmentRoomResult({ eventId: 9, extra: 1 })).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["extra"] },
    });
    expect(decodeAnnounceAssignmentRoomResult({})).toMatchObject({
      ok: false,
      issue: { code: "invalid_wire", path: ["eventId"] },
    });
  });
});
