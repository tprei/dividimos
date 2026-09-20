import { describe, expect, it } from "vitest";
import {
  decodeAssignmentRoomView,
  decodeFinalizeAssignmentRoomResult,
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
