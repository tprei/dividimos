import { describe, expect, it } from "vitest";
import type { GroupEvent } from "@/types/ledger";
import { describeEvent, type EventCopyContext } from "./event-copy";

function makeEvent(overrides: Partial<GroupEvent>): GroupEvent {
  return {
    id: 1,
    groupId: "group-1",
    actorId: "u1",
    kind: "expense_created",
    expenseId: null,
    settlementId: null,
    subjectUserId: null,
    payload: {},
    createdAt: "2026-09-06T12:00:00Z",
    actor: {
      id: "u1",
      handle: "alice",
      name: "Alice",
      avatarUrl: null,
    },
    expenseTitle: null,
    ...overrides,
  };
}

const baseCtx: EventCopyContext = {
  actorName: "Alice",
  nameOf: (id: string) => {
    if (id === "u1") return "Alice";
    if (id === "u2") return "Bruno";
    if (id === "u3") return "Carol";
    if (id === "viewer-id") return "você";
    return "alguém";
  },
  expenseTitle: null,
  viewerId: "viewer-id",
};

describe("describeEvent", () => {
  describe("expense_created", () => {
    it("describes expense creation with title and formatted total", () => {
      const event = makeEvent({
        kind: "expense_created",
        expenseTitle: "Almoço",
        payload: { totalCents: 5430 },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice adicionou Almoço (R$\u00A054,30)");
    });
  });

  describe("expense_edited", () => {
    it("describes title change sub-sentence", () => {
      const event = makeEvent({
        kind: "expense_edited",
        payload: {
          title: ["Almoço", "Jantar"],
          totalCents: null,
          participantsAdded: [],
          participantsRemoved: [],
          payersChanged: false,
        },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice mudou o nome de “Almoço” para “Jantar”");
    });

    it("describes totalCents change sub-sentence", () => {
      const event = makeEvent({
        kind: "expense_edited",
        payload: {
          title: null,
          totalCents: [5000, 7500],
          participantsAdded: [],
          participantsRemoved: [],
          payersChanged: false,
        },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice mudou o total de R$\u00A050,00 para R$\u00A075,00",
      );
    });

    it("describes participantsAdded sub-sentence with multiple names", () => {
      const event = makeEvent({
        kind: "expense_edited",
        payload: {
          title: null,
          totalCents: null,
          participantsAdded: ["u2", "u3"],
          participantsRemoved: [],
          payersChanged: false,
        },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice adicionou Bruno e Carol");
    });

    it("describes participantsRemoved sub-sentence", () => {
      const event = makeEvent({
        kind: "expense_edited",
        payload: {
          title: null,
          totalCents: null,
          participantsAdded: [],
          participantsRemoved: ["u2"],
          payersChanged: false,
        },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice removeu Bruno");
    });

    it("describes payersChanged sub-sentence", () => {
      const event = makeEvent({
        kind: "expense_edited",
        payload: {
          title: null,
          totalCents: null,
          participantsAdded: [],
          participantsRemoved: [],
          payersChanged: true,
        },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice mudou quem pagou");
    });

    it("falls back to generic edit sentence with title when summary is empty", () => {
      const event = makeEvent({
        kind: "expense_edited",
        expenseTitle: "Almoço",
        payload: {},
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice editou Almoço");
    });
  });

  describe("expense_deleted", () => {
    it("describes expense deletion", () => {
      const event = makeEvent({
        kind: "expense_deleted",
        expenseTitle: "Almoço",
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice excluiu Almoço");
    });
  });

  describe("expense_restored", () => {
    it("describes expense restoration", () => {
      const event = makeEvent({
        kind: "expense_restored",
        expenseTitle: "Almoço",
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice restaurou Almoço");
    });
  });

  describe("settlement_recorded", () => {
    it("describes settlement recorded when viewer is not payee", () => {
      const event = makeEvent({
        kind: "settlement_recorded",
        payload: { amountCents: 3000, toUserId: "u2" },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice marcou um pagamento de R$\u00A030,00 para Bruno",
      );
    });

    it("describes settlement recorded when viewer is payee", () => {
      const event = makeEvent({
        kind: "settlement_recorded",
        payload: { amountCents: 3000, toUserId: "viewer-id" },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice marcou um pagamento de R$\u00A030,00 pra você",
      );
    });
  });

  describe("settlement_confirmed", () => {
    it("describes settlement confirmation", () => {
      const event = makeEvent({
        kind: "settlement_confirmed",
        payload: { amountCents: 4500, fromUserId: "u2" },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice confirmou o pagamento de R$\u00A045,00 de Bruno",
      );
    });
  });

  describe("settlement_voided", () => {
    it("describes voided settlement that was confirmed", () => {
      const event = makeEvent({
        kind: "settlement_voided",
        payload: { amountCents: 2500, wasConfirmed: true },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice desfez um pagamento de R$\u00A025,00",
      );
    });

    it("describes voided settlement that was pending (not confirmed)", () => {
      const event = makeEvent({
        kind: "settlement_voided",
        payload: { amountCents: 2500, wasConfirmed: false },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice cancelou um pagamento de R$\u00A025,00",
      );
    });
  });

  describe("member_invited", () => {
    it("describes member invitation with one or more members", () => {
      const event = makeEvent({
        kind: "member_invited",
        payload: { userIds: ["u2", "u3"] },
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice convidou Bruno e Carol");
    });
  });

  describe("member_joined", () => {
    it("describes member joined", () => {
      const event = makeEvent({
        kind: "member_joined",
        subjectUserId: "u2",
      });
      expect(describeEvent(event, baseCtx)).toBe("Bruno entrou no grupo");
    });
  });

  describe("member_left", () => {
    it("describes member left", () => {
      const event = makeEvent({
        kind: "member_left",
        subjectUserId: "u2",
      });
      expect(describeEvent(event, baseCtx)).toBe("Bruno saiu do grupo");
    });
  });

  describe("member_removed", () => {
    it("describes member removed", () => {
      const event = makeEvent({
        kind: "member_removed",
        subjectUserId: "u2",
      });
      expect(describeEvent(event, baseCtx)).toBe("Alice removeu Bruno");
    });
  });

  describe("guest_claimed", () => {
    it("describes guest claimed with display name", () => {
      const event = makeEvent({
        kind: "guest_claimed",
        subjectUserId: "u2",
        payload: { displayName: "Bruninho" },
      });
      expect(describeEvent(event, baseCtx)).toBe("Bruno entrou como Bruninho");
    });
  });

  describe("nudge", () => {
    it("describes nudge", () => {
      const event = makeEvent({
        kind: "nudge",
        subjectUserId: "u2",
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice lembrou Bruno de acertar as contas",
      );
    });
  });

  describe("fallbacks", () => {
    it("falls back to 'Alguém' when actorName is missing", () => {
      const event = makeEvent({
        kind: "expense_created",
        expenseTitle: "Almoço",
        payload: { totalCents: 1000 },
      });
      const ctxWithoutActor: EventCopyContext = {
        ...baseCtx,
        actorName: "",
      };
      expect(describeEvent(event, ctxWithoutActor)).toBe(
        "Alguém adicionou Almoço (R$\u00A010,00)",
      );
    });

    it("falls back to 'alguém' when nameOf returns 'alguém' for unknown user id", () => {
      const event = makeEvent({
        kind: "settlement_recorded",
        payload: { amountCents: 2000, toUserId: "unknown-user-id" },
      });
      expect(describeEvent(event, baseCtx)).toBe(
        "Alice marcou um pagamento de R$\u00A020,00 para alguém",
      );
    });
  });
});
