import { describe, expect, it } from "vitest";
import type { Bootstrap } from "@/types/ledger";
import {
  decodeBootstrap,
  decodeChatMessage,
  decodeConversation,
  decodeExpenseDetail,
  decodeExpensePayload,
  decodeGroupEvent,
  decodeGuestClaimResolution,
  decodeGuestParticipant,
  decodeInviteLink,
  decodeInvitePreview,
  decodeMutationAck,
  decodeUserProfile,
  decodeUserProfileOrNull,
  decodeVendorCharge,
  decodeVendorCharges,
} from "./decode";

describe("decodeBootstrap", () => {
  const fixture: Bootstrap = {
    me: {
      id: "user-1",
      handle: "alice",
      name: "Alice",
      avatarUrl: null,
      email: "alice@example.com",
      pixKeyType: "email",
      pixKeyHint: "al***@example.com",
      onboarded: true,
      notificationPreferences: {
        expenses: true,
        settlements: false,
      },
    },
    groups: [
      {
        group: {
          id: "group-1",
          kind: "group",
          name: "Trip",
          creatorId: "user-1",
          dmUserA: null,
          dmUserB: null,
          ledgerVersion: 3,
          createdAt: "2026-09-01T12:00:00.000Z",
        },
        members: [
          {
            groupId: "group-1",
            userId: "user-1",
            status: "accepted",
            invitedBy: null,
            acceptedAt: "2026-09-01T12:00:00.000Z",
            user: {
              id: "user-1",
              handle: "alice",
              name: "Alice",
              avatarUrl: null,
            },
          },
        ],
        balances: [
          {
            kind: "user",
            participantId: "user-1",
            netCents: 1500,
          },
        ],
        guests: [{ id: "guest-1", displayName: "Zé", expenseId: "exp-1" }],
        settlements: [
          {
            id: "settle-1",
            operationId: "op-1",
            groupId: "group-1",
            fromUserId: "user-2",
            toUserId: "user-1",
            amountCents: 1500,
            status: "confirmed",
            createdBy: "user-2",
            createdAt: "2026-09-02T10:00:00.000Z",
            confirmedAt: null,
            voidedAt: null,
            voidedBy: null,
          },
        ],
        recentExpenses: [
          {
            id: "exp-1",
            groupId: "group-1",
            creatorId: "user-1",
            status: "active",
            occurredOn: "2026-09-01",
            createdAt: "2026-09-01T13:00:00.000Z",
            versionNo: 1,
            title: "Lunch",
            merchantName: "Cafe",
            expenseType: "single_amount",
            totalCents: 3000,
            myShareCents: 1500,
            myPaidCents: 3000,
            participantCount: 2,
          },
        ],
        expenseCount: 0,
        lastEventId: 42,
        unreadCount: 0,
        lastMessage: {
          content: "See you there!",
          senderId: "user-1",
          createdAt: "2026-09-02T11:00:00.000Z",
        },
        lastActivityAt: "2026-09-02T11:00:00.000Z",
        pairwiseEdges: [
          {
            fromKind: "user",
            fromId: "user-2",
            toId: "user-1",
            amountCents: 1500,
          },
        ],
      },
    ],
    serverTime: "2026-09-05T00:00:00.000Z",
  };

  it("returns ok: true with value deep-equal to the fixture", () => {
    const result = decodeBootstrap(fixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fixture);
    }
  });

  it("rejects extra key at root", () => {
    const invalid = { ...fixture, extraKey: "unexpected" };
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["extraKey"]);
    }
  });

  it("rejects missing serverTime", () => {
    const invalid: Record<string, unknown> = { ...fixture };
    delete invalid.serverTime;
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["serverTime"]);
    }
  });

  it("rejects missing expenseCount", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    delete invalid.groups[0].expenseCount;
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "expenseCount"]);
    }
  });

  it("rejects netCents as a string", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    invalid.groups[0].balances[0].netCents = "1500";
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "balances", 0, "netCents"]);
    }
  });

  it("rejects kind outside the enum", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    invalid.groups[0].group.kind = "nonexistent_kind";
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "group", "kind"]);
    }
  });

  it("rejects lastMessage missing a key", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    delete invalid.groups[0].lastMessage.createdAt;
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "lastMessage", "createdAt"]);
    }
  });

  it("rejects a pairwiseEdges entry with an unknown key", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    invalid.groups[0].pairwiseEdges[0].toKind = "user";
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "pairwiseEdges", 0, "toKind"]);
    }
  });

  it("rejects a pairwiseEdges entry with a non-integer amount", () => {
    const invalid = JSON.parse(JSON.stringify(fixture));
    invalid.groups[0].pairwiseEdges[0].amountCents = 15.5;
    const result = decodeBootstrap(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["groups", 0, "pairwiseEdges", 0, "amountCents"]);
    }
  });
});

describe("decodeMutationAck", () => {
  it("accepts {groupId, ledgerVersion, eventId: null}", () => {
    const raw = {
      groupId: "group-1",
      ledgerVersion: 4,
      eventId: null,
    };
    const result = decodeMutationAck(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        groupId: "group-1",
        ledgerVersion: 4,
        eventId: null,
      });
    }
  });

  it("accepts with expenseId and versionNo", () => {
    const raw = {
      groupId: "group-1",
      ledgerVersion: 5,
      eventId: 99,
      expenseId: "exp-123",
      versionNo: 2,
    };
    const result = decodeMutationAck(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        groupId: "group-1",
        ledgerVersion: 5,
        eventId: 99,
        expenseId: "exp-123",
        versionNo: 2,
      });
    }
  });

  it("rejects an unknown key", () => {
    const raw = {
      groupId: "group-1",
      ledgerVersion: 1,
      eventId: null,
      unknownKey: "bad",
    };
    const result = decodeMutationAck(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["unknownKey"]);
    }
  });
});

describe("decodeExpensePayload", () => {
  it("accepts a guest with guestId: null", () => {
    const raw = {
      items: [],
      participants: [
        {
          kind: "guest",
          guestId: null,
          displayName: "Guest Bob",
        },
      ],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.participants[0]).toEqual({
        kind: "guest",
        guestId: null,
        displayName: "Guest Bob",
      });
    }
  });

  it("accepts the authored split method the server now sends", () => {
    const raw = {
      items: [],
      participants: [{ kind: "user", userId: "user-1" }],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
      splitMethod: "percentage",
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.splitMethod).toBe("percentage");
  });

  it("accepts a version written before the method was recorded", () => {
    const raw = {
      items: [],
      participants: [{ kind: "user", userId: "user-1" }],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.splitMethod).toBeNull();
  });

  it("treats a null method as not stated", () => {
    const raw = {
      items: [],
      participants: [{ kind: "user", userId: "user-1" }],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
      splitMethod: null,
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.splitMethod).toBeNull();
  });

  it("rejects a method the division controls cannot produce", () => {
    const raw = {
      items: [],
      participants: [{ kind: "user", userId: "user-1" }],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
      splitMethod: "weighted",
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toEqual(["splitMethod"]);
  });

  it("rejects a payer with a non-integer amount", () => {
    const raw = {
      items: [],
      participants: [{ kind: "user", userId: "user-1" }],
      shares: [1000],
      payers: [{ participantIndex: 0, amountCents: 12.5 }],
      itemAssignments: null,
    };
    const result = decodeExpensePayload(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_wire");
      expect(result.issue.path).toEqual(["payers", 0, "amountCents"]);
    }
  });
});

describe("additional wire decoders", () => {
  it("decodes user profile and null profile", () => {
    expect(decodeUserProfileOrNull(null)).toEqual({ ok: true, value: null });
    const user = {
      id: "u-1",
      handle: "bob",
      name: "Bob",
      avatarUrl: "https://example.com/a.png",
    };
    expect(decodeUserProfile(user)).toEqual({ ok: true, value: user });
  });

  it("decodes group event with arbitrary json payload", () => {
    const event = {
      id: 1,
      groupId: "g-1",
      actorId: "u-1",
      kind: "expense_created",
      expenseId: "e-1",
      settlementId: null,
      subjectUserId: null,
      payload: { title: "Dinner", totalCents: 5000, customData: [1, 2, 3] },
      createdAt: "2026-09-01T00:00:00.000Z",
      actor: { id: "u-1", handle: "u1", name: "User 1", avatarUrl: null },
      expenseTitle: "Dinner",
    };
    const result = decodeGroupEvent(event);
    expect(result.ok).toBe(true);
  });

  it("decodes chat message and conversation", () => {
    const msg = {
      id: "m-1",
      clientId: "c-1",
      groupId: "g-1",
      senderId: "u-1",
      content: "Hello",
      createdAt: "2026-09-01T00:00:00.000Z",
      sender: { id: "u-1", handle: "u1", name: "User 1", avatarUrl: null },
    };
    expect(decodeChatMessage(msg).ok).toBe(true);

    const conv = {
      messages: [msg],
      messageCursor: { createdAt: "2026-09-01T00:00:00.123456+00:00", id: "m-1" },
      messagesComplete: false,
      events: [],
      eventCursor: { createdAt: "2026-09-01T00:00:00+00", id: 42 },
      eventsComplete: true,
      readWatermark: { lastReadAt: "2026-09-01T00:00:00.500000Z", lastReadMessageId: "m-1" },
    };
    const decoded = decodeConversation(conv);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // Cursor timestamps keep microsecond precision, and event ids become
    // strings because a PostgreSQL bigint cannot round-trip as a JS number.
    expect(decoded.value.messageCursor?.createdAt).toBe("2026-09-01T00:00:00.123456Z");
    expect(decoded.value.eventCursor?.createdAt).toBe("2026-09-01T00:00:00.000000Z");
    expect(decoded.value.eventCursor?.id).toBe("42");
    expect(decoded.value.readWatermark?.lastReadMessageId).toBe("m-1");

    // The old two-key envelope and an unsafe event id must be rejected.
    expect(decodeConversation({ messages: [msg], events: [] }).ok).toBe(false);
    expect(
      decodeConversation({
        ...conv,
        eventCursor: { createdAt: "2026-09-01T00:00:00Z", id: 2 ** 53 },
      }).ok,
    ).toBe(false);
  });

  it("decodes invite link and preview", () => {
    const link = {
      groupId: "g-1",
      token: "tok-abc",
      expiresAt: null,
      maxUses: 10,
    };
    expect(decodeInviteLink(link).ok).toBe(true);

    const preview = {
      groupName: "Test Group",
      memberCount: 5,
      creatorName: "Alice",
      valid: true,
    };
    expect(decodeInvitePreview(preview).ok).toBe(true);
  });

  it("decodes guest claim resolution", () => {
    const claim = {
      guestId: "g-1",
      displayName: "Guest 1",
      expenseTitle: "Dinner",
      groupName: "Trip",
      shareCents: 2000,
      status: "ready",
    };
    expect(decodeGuestClaimResolution(claim).ok).toBe(true);
  });

  it("decodes vendor charges", () => {
    const charge = {
      id: "vc-1",
      userId: "u-1",
      amountCents: 500,
      description: "Coffee",
      status: "received",
      createdAt: "2026-09-01T00:00:00.000Z",
      confirmedAt: "2026-09-01T00:01:00.000Z",
    };
    expect(decodeVendorCharge(charge).ok).toBe(true);
    expect(decodeVendorCharges([charge]).ok).toBe(true);
  });

  it("decodes expense detail", () => {
    const detail = {
      expense: {
        id: "e-1",
        groupId: "g-1",
        creatorId: "u-1",
        status: "active",
        currentVersionNo: 1,
        occurredOn: "2026-09-01",
        createdAt: "2026-09-01T00:00:00.000Z",
        deletedAt: null,
        deletedBy: null,
      },
      current: {
        expenseId: "e-1",
        versionNo: 1,
        authorId: "u-1",
        createdAt: "2026-09-01T00:00:00.000Z",
        occurredOn: "2026-09-01",
        title: "Coffee",
        merchantName: null,
        expenseType: "single_amount",
        totalCents: 1000,
        serviceFeeBasisPoints: 0,
        fixedFeeCents: 0,
        payload: {
          items: [],
          participants: [{ kind: "user", userId: "u-1" }],
          shares: [1000],
          payers: [{ participantIndex: 0, amountCents: 1000 }],
          itemAssignments: null,
        },
        changeSummary: null,
      },
      versions: [],
      participants: [
        {
          participantIndex: 0,
          kind: "user",
          shareCents: 1000,
          paidCents: 1000,
          user: { id: "u-1", handle: "u1", name: "User 1", avatarUrl: null },
          guest: null,
        },
      ],
      group: {
        id: "g-1",
        name: "Trip",
        kind: "group",
      },
    };
    expect(decodeExpenseDetail(detail).ok).toBe(true);
  });
  it("decodes guest participants with the claim link generation and exact keys", () => {
    const guest = {
      id: "guest-1",
      displayName: "Zé",
      claimedBy: null,
      claimLinkGeneration: 2,
    };
    const result = decodeGuestParticipant(guest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(guest);
    }

    expect(
      decodeGuestParticipant({ ...guest, unexpected: true }).ok,
    ).toBe(false);
    expect(
      decodeGuestParticipant({
        id: "guest-1",
        displayName: "Zé",
        claimedBy: null,
      }).ok,
    ).toBe(false);
    expect(
      decodeGuestParticipant({
        id: "guest-1",
        displayName: "Zé",
        claimedBy: null,
        claimLinkGeneration: 1.5,
      }).ok,
    ).toBe(false);
  });
});
