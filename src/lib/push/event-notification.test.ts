import { describe, expect, it } from "vitest";
import {
  categoryFor,
  eventNotification,
  recipientsFor,
  type EventNotificationContext,
  type EventNotificationMember,
  type GroupEventRow,
} from "./event-notification";

const NAMES: Record<string, string> = {
  ana: "Ana",
  bruno: "Bruno",
  carol: "Carol",
};

function event(overrides: Partial<GroupEventRow> = {}): GroupEventRow {
  const row: GroupEventRow = {
    id: 101,
    group_id: "group-1",
    actor_id: "ana",
    kind: "expense_created",
    expense_id: "expense-1",
    settlement_id: null,
    subject_user_id: null,
    payload: {},
    created_at: "2026-09-06T12:00:00Z",
    notified_at: null,
  };
  return { ...row, ...overrides };
}

function member(
  userId: string,
  status: "invited" | "accepted" = "accepted",
  prefs: EventNotificationMember["notificationPreferences"] = {},
): EventNotificationMember {
  return {
    userId,
    name: NAMES[userId] ?? userId,
    status,
    notificationPreferences: prefs,
  };
}

function ctx(
  viewerId: string,
  overrides: Partial<EventNotificationContext> = {},
): EventNotificationContext {
  return {
    groupName: "Viagem",
    isDm: false,
    actorName: "Ana",
    viewerId,
    nameOf: (id) => NAMES[id] ?? "",
    expenseTitle: "Jantar",
    recipientShareCents: null,
    ...overrides,
  };
}

describe("recipientsFor", () => {
  it("sends expense events to accepted members except the actor", () => {
    const members = [member("ana"), member("bruno"), member("carol", "invited")];
    expect(recipientsFor(event(), members)).toEqual(["bruno"]);
  });

  it("keeps every accepted member when the event has no actor", () => {
    const members = [member("bruno"), member("carol")];
    expect(recipientsFor(event({ actor_id: null }), members)).toEqual([
      "bruno",
      "carol",
    ]);
  });

  it("sends settlement kinds only to the counterparty", () => {
    const members = [member("ana"), member("bruno"), member("carol")];
    const row = event({
      kind: "settlement_recorded",
      expense_id: null,
      settlement_id: "st-1",
      subject_user_id: "bruno",
      payload: { amountCents: 3000, fromUserId: "ana", toUserId: "bruno" },
    });
    expect(recipientsFor(row, members)).toEqual(["bruno"]);
  });

  it("sends nudges only to the subject", () => {
    const members = [member("ana"), member("bruno")];
    const row = event({
      kind: "nudge",
      expense_id: null,
      subject_user_id: "bruno",
      payload: { amountCents: 500 },
    });
    expect(recipientsFor(row, members)).toEqual(["bruno"]);
  });

  it("skips settlement subjects that are not group members", () => {
    const row = event({
      kind: "settlement_voided",
      expense_id: null,
      subject_user_id: "zeca",
    });
    expect(recipientsFor(row, [member("ana")])).toEqual([]);
  });

  it("sends member_invited to the invited users only", () => {
    const members = [member("ana"), member("carol", "invited")];
    const row = event({
      kind: "member_invited",
      expense_id: null,
      subject_user_id: "carol",
      payload: { userIds: ["carol", "zeca"] },
    });
    expect(recipientsFor(row, members)).toEqual(["carol"]);
  });

  it("excludes actor and subject from join, leave, removal and claim events", () => {
    const members = [member("ana"), member("bruno"), member("carol")];
    const joined = event({
      kind: "member_joined",
      expense_id: null,
      actor_id: "bruno",
      subject_user_id: "bruno",
    });
    expect(recipientsFor(joined, members)).toEqual(["ana", "carol"]);
    const left = event({
      kind: "member_left",
      expense_id: null,
      actor_id: "bruno",
      subject_user_id: "bruno",
    });
    expect(recipientsFor(left, members)).toEqual(["ana", "carol"]);
    const removed = event({
      kind: "member_removed",
      expense_id: null,
      actor_id: "ana",
      subject_user_id: "bruno",
    });
    expect(recipientsFor(removed, members)).toEqual(["carol"]);
    const claimed = event({
      kind: "guest_claimed",
      expense_id: null,
      actor_id: "bruno",
      subject_user_id: "bruno",
    });
    expect(recipientsFor(claimed, members)).toEqual(["ana", "carol"]);
  });
});

describe("categoryFor", () => {
  it("maps kinds to notification categories", () => {
    expect(categoryFor("expense_created")).toBe("expenses");
    expect(categoryFor("expense_deleted")).toBe("expenses");
    expect(categoryFor("settlement_recorded")).toBe("settlements");
    expect(categoryFor("settlement_voided")).toBe("settlements");
    expect(categoryFor("nudge")).toBe("nudges");
    expect(categoryFor("member_invited")).toBe("groups");
    expect(categoryFor("guest_claimed")).toBe("groups");
  });
});

describe("eventNotification", () => {
  it("builds expense_created copy with the recipient share", () => {
    const payload = eventNotification(
      event({ payload: { totalCents: 5000 } }),
      ctx("bruno", { recipientShareCents: 2500 }),
    );
    expect(payload).toEqual({
      title: "Viagem",
      body: "Ana adicionou Jantar (R$\u00A050,00) · sua parte: R$\u00A025,00",
      url: "/app/bill/expense-1",
      tag: "event-101",
      category: "expenses",
    });
  });

  it("omits the share suffix when the recipient has no participant row", () => {
    const payload = eventNotification(
      event({ payload: { totalCents: 5000 } }),
      ctx("carol"),
    );
    expect(payload.body).toBe("Ana adicionou Jantar (R$\u00A050,00)");
  });

  it("uses the change summary for edits", () => {
    const payload = eventNotification(
      event({
        kind: "expense_edited",
        payload: {
          changeSummary: {
            title: null,
            totalCents: [5000, 7500],
            participantsAdded: [],
            participantsRemoved: [],
            payersChanged: false,
          },
        },
      }),
      ctx("bruno"),
    );
    expect(payload.body).toBe(
      "Ana mudou o total de R$\u00A050,00 para R$\u00A075,00",
    );
  });

  it("addresses the settlement counterparty directly", () => {
    const payload = eventNotification(
      event({
        kind: "settlement_recorded",
        expense_id: null,
        settlement_id: "st-1",
        subject_user_id: "bruno",
        payload: { amountCents: 3000, fromUserId: "ana", toUserId: "bruno" },
      }),
      ctx("bruno"),
    );
    expect(payload.body).toBe("Ana pagou R$\u00A030,00 pra você");
    expect(payload.url).toBe("/app");
    expect(payload.category).toBe("settlements");
  });

  it("states the real payer and payee when the creditor records", () => {
    const row = event({
      kind: "settlement_recorded",
      actor_id: "bruno",
      expense_id: null,
      settlement_id: "st-1",
      subject_user_id: "ana",
      payload: { amountCents: 3000, fromUserId: "ana", toUserId: "bruno" },
    });
    expect(eventNotification(row, ctx("ana")).body).toBe(
      "Você pagou R$\u00A030,00 para Bruno",
    );
    expect(eventNotification(row, ctx("bruno")).body).toBe(
      "Ana pagou R$\u00A030,00 pra você",
    );
  });

  it("describes nudges for the subject", () => {
    const payload = eventNotification(
      event({
        kind: "nudge",
        expense_id: null,
        subject_user_id: "bruno",
        payload: { amountCents: 500 },
      }),
      ctx("bruno"),
    );
    expect(payload.body).toBe("Ana lembrou Bruno de acertar as contas");
    expect(payload.url).toBe("/app");
    expect(payload.category).toBe("nudges");
  });

  it("uses the actor name as DM title and links membership kinds to the conversation", () => {
    const payload = eventNotification(
      event({
        kind: "member_invited",
        expense_id: null,
        subject_user_id: "carol",
        payload: { userIds: ["carol"] },
      }),
      ctx("carol", { isDm: true }),
    );
    expect(payload.title).toBe("Ana");
    expect(payload.body).toBe("Ana convidou Carol");
    expect(payload.url).toBe("/app/conversations/ana");
    expect(payload.category).toBe("groups");
  });

  it("keeps the group link for membership kinds outside DMs", () => {
    const payload = eventNotification(
      event({
        kind: "member_removed",
        expense_id: null,
        actor_id: "ana",
        subject_user_id: "bruno",
      }),
      ctx("carol"),
    );
    expect(payload.body).toBe("Ana removeu Bruno");
    expect(payload.url).toBe("/app/groups/group-1");
    expect(payload.category).toBe("groups");
  });

  it("falls back to the group link when an expense event has no expense", () => {
    const payload = eventNotification(event({ expense_id: null }), ctx("bruno"));
    expect(payload.url).toBe("/app/groups/group-1");
  });
});
