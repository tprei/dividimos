import { describe, expect, it } from "vitest";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { Me, UserProfile } from "@/types/ledger";
import {
  resolveDraftActors,
  resolveDraftExpense,
  type ResolvedDraftActors,
} from "./conversation-expense-builder";

const me: Me = {
  id: "user-me",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const counterparty: UserProfile = {
  id: "user-other",
  handle: "bob",
  name: "Bob Silva",
  avatarUrl: null,
};

function draft(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Jantar",
    amountCents: 10000,
    expenseType: "single_amount",
    splitType: "equal",
    allocations: [],
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

const actors: ResolvedDraftActors = {
  participantIds: [me.id, counterparty.id],
  payerId: counterparty.id,
};

describe("resolveDraftActors", () => {
  it("rejects an explicit unknown payer", () => {
    const result = resolveDraftActors(draft({ payerHandle: "carol" }), me, counterparty);

    expect(result).toEqual({ kind: "error", message: "Não consegui identificar quem pagou." });
  });

  it("rejects null and mixed participant matches", () => {
    const result = resolveDraftActors(
      draft({
        participants: [
          { spokenName: "Bob", matchedHandle: "bob", confidence: "high" },
          { spokenName: "Carol", matchedHandle: null, confidence: "low" },
        ],
      }),
      me,
      counterparty,
    );

    expect(result.kind).toBe("error");
  });

  it("rejects duplicate allocation actors instead of falling back to equal", () => {
    const result = resolveDraftActors(
      draft({
        splitType: "custom",
        allocations: [
          { participantHandle: "alice", shareAmountCents: 4000 },
          { participantHandle: "@alice", shareAmountCents: 6000 },
        ],
      }),
      me,
      counterparty,
    );

    expect(result.kind).toBe("error");
  });

  it("rejects a low-confidence matched participant", () => {
    const result = resolveDraftActors(
      draft({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "low" }],
      }),
      me,
      counterparty,
    );

    expect(result.kind).toBe("error");
  });

  it("rejects equal handles before resolving either actor", () => {
    const result = resolveDraftActors(
      draft(),
      me,
      { ...counterparty, handle: "@Alice" },
    );

    expect(result.kind).toBe("error");
  });

  it("preserves valid explicit participants and payer", () => {
    const result = resolveDraftActors(
      draft({
        participants: [
          { spokenName: "Alice", matchedHandle: "SELF", confidence: "high" },
          { spokenName: "Bob", matchedHandle: " @BOB ", confidence: "high" },
        ],
        payerHandle: "@bob",
      }),
      me,
      counterparty,
    );

    expect(result).toEqual({ kind: "resolved", actors });
  });
  it("treats the mentioned counterparty as the explicit DM actor", () => {
    const result = resolveDraftActors(
      draft({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "high" }],
      }),
      me,
      counterparty,
    );

    expect(result).toEqual({ kind: "resolved", actors: { ...actors, payerId: me.id } });
  });

});

describe("resolveDraftExpense", () => {
  it("keeps the default equal split when no actors were explicit", () => {
    const result = resolveDraftExpense("group-1", me, counterparty, draft());

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.payload.participants).toEqual([
        { kind: "user", userId: me.id },
        { kind: "user", userId: counterparty.id },
      ]);
      expect(result.payload.payers).toEqual([{ participantIndex: 0, amountCents: 10000 }]);
    }
  });

  it("keeps custom shares and payer identity without adding actors", () => {
    const result = resolveDraftExpense(
      "group-1",
      me,
      counterparty,
      draft({
        splitType: "custom",
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 3000 },
          { participantHandle: " @BOB ", shareAmountCents: 7000 },
        ],
        payerHandle: "bob",
      }),
    );

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.payload.shares).toEqual([3000, 7000]);
      expect(result.payload.payers).toEqual([{ participantIndex: 1, amountCents: 10000 }]);
    }
  });

  it("carries resolved actors into the itemized wizard URL", () => {
    const result = resolveDraftExpense(
      "group-1",
      me,
      counterparty,
      draft({ expenseType: "itemized", payerHandle: "bob" }),
    );

    expect(result).toEqual({
      kind: "wizard",
      url: expect.stringContaining(
        "participantIds=user-me%2Cuser-other&payerId=user-other",
      ),
    });
    expect(result.kind === "wizard" && result.url).toContain("type=itemized");
  });

  it("does not open the wizard for an unresolved actor", () => {
    const result = resolveDraftExpense(
      "group-1",
      me,
      counterparty,
      draft({ payerHandle: "someone-else" }),
    );

    expect(result.kind).toBe("error");
  });
});
