import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { buildExpensePayload } from "./payload";
import {
  makeExpenseDetail,
  makeExpenseVersion,
  makeGuestParticipant,
  makeUserParticipant,
} from "@/test/fixtures";
import type { User } from "@/types";

const userAlice: User = {
  id: "user-alice",
  email: "alice@example.com",
  handle: "alice",
  name: "Alice Silva",
  pixKeyType: "email",
  pixKeyHint: "alice@example.com",
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const userBob: User = {
  id: "user-bob",
  email: "bob@example.com",
  handle: "bob",
  name: "Bob Santos",
  pixKeyType: "email",
  pixKeyHint: "bob@example.com",
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const userCarol: User = {
  id: "user-carol",
  email: "carol@example.com",
  handle: "carol",
  name: "Carol Lima",
  pixKeyType: "email",
  pixKeyHint: "carol@example.com",
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("buildExpensePayload", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
  });

  it("returns incomplete_expense when expense is null", () => {
    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toEqual({ code: "incomplete_expense" });
  });

  it("returns incomplete_expense when total amount is 0", () => {
    const store = useBillStore.getState();
    store.createExpense("Vazio", "single_amount");
    store.addParticipant(userAlice);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toEqual({ code: "incomplete_expense" });
  });

  it("builds an itemized expense with 10% fee correctly", () => {
    const store = useBillStore.getState();
    store.createExpense("  Jantar Italiano  ", "itemized", "  Cantina do Zé  ");
    store.addParticipant(userAlice);
    store.addParticipant(userBob);

    store.addItem({
      description: "Pizza Margherita",
      quantity: 1000,
      unitPriceCents: 5000,
      totalPriceCents: 5000,
    });
    store.addItem({
      description: "Cerveja Artesanal",
      quantity: 2000,
      unitPriceCents: 1500,
      totalPriceCents: 3000,
    });

    const items = useBillStore.getState().items;
    store.splitItemEqually(items[0].id, [userAlice.id, userBob.id]);
    store.splitItemEqually(items[1].id, [userBob.id]);

    const payerResult = store.setPayerFull(userAlice.id);
    expect(payerResult).toBeNull();

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { header, payload } = result.value;

    expect(header).toEqual({
      occurredOn: "2026-09-05",
      title: "Jantar Italiano",
      merchantName: "Cantina do Zé",
      expenseType: "itemized",
      totalCents: 8800,
      serviceFeeBasisPoints: 1000,
      fixedFeeCents: 0,
    });

    expect(payload.items).toEqual([
      {
        description: "Pizza Margherita",
        quantityMilliunits: 1000,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      },
      {
        description: "Cerveja Artesanal",
        quantityMilliunits: 2000,
        unitPriceCents: 1500,
        totalPriceCents: 3000,
      },
    ]);

    expect(payload.participants).toEqual([
      { kind: "user", userId: "user-alice" },
      { kind: "user", userId: "user-bob" },
    ]);

    const sharesSum = payload.shares.reduce((sum, s) => sum + s, 0);
    expect(sharesSum).toBe(8800);
    expect(payload.shares).toEqual([2750, 6050]);

    expect(payload.payers).toEqual([
      { participantIndex: 0, amountCents: 8800 },
    ]);

    expect(payload.itemAssignments).not.toBeNull();
    if (!payload.itemAssignments) return;

    const item0Assignments = payload.itemAssignments.filter((a) => a.itemIndex === 0);
    const item0Total = item0Assignments.reduce((sum, a) => sum + a.amountCents, 0);
    expect(item0Total).toBe(5000);

    const item1Assignments = payload.itemAssignments.filter((a) => a.itemIndex === 1);
    const item1Total = item1Assignments.reduce((sum, a) => sum + a.amountCents, 0);
    expect(item1Total).toBe(3000);
  });

  it("handles guest participant with guestId null for locally added guests", () => {
    const store = useBillStore.getState();
    store.createExpense("Almoço", "itemized");
    store.addParticipant(userAlice);
    const guestId = store.addGuest("Daniel");

    store.addItem({
      description: "Prato Executivo",
      quantity: 1000,
      unitPriceCents: 4000,
      totalPriceCents: 4000,
    });

    const items = useBillStore.getState().items;
    store.splitItemEqually(items[0].id, [userAlice.id, guestId]);
    store.setPayerFull(userAlice.id);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = result.value;
    expect(payload.participants).toEqual([
      { kind: "user", userId: "user-alice" },
      { kind: "guest", guestId: null, displayName: "Daniel" },
    ]);

    expect(payload.shares).toEqual([2200, 2200]);
    expect(payload.shares.reduce((sum, s) => sum + s, 0)).toBe(4400);
  });

  it("retains persisted guest remoteId when hydrated from an expense detail", () => {
    const store = useBillStore.getState();
    store.hydrateFromDetail(
      makeExpenseDetail({
        expense: { id: "exp-loaded", groupId: "group-1" },
        current: makeExpenseVersion({
          expenseId: "exp-loaded",
          title: "Passeio",
          expenseType: "single_amount",
          totalCents: 10000,
          serviceFeeBasisPoints: 0,
          payload: {
            items: [],
            participants: [
              { kind: "user", userId: "user-alice" },
              { kind: "guest", guestId: "uuid-guest-helena", displayName: "Helena" },
            ],
            shares: [5000, 5000],
            payers: [{ participantIndex: 0, amountCents: 10000 }],
            itemAssignments: null,
          },
        }),
        participants: [
          makeUserParticipant(0, 5000, 10000),
          makeGuestParticipant(1, 5000, { id: "uuid-guest-helena", displayName: "Helena", claimedBy: null }),
        ],
      }),
      [],
    );
    expect(useBillStore.getState().expense?.id).toBe("exp-loaded");

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = result.value;
    expect(payload.participants).toEqual([
      { kind: "user", userId: "user-alice" },
      { kind: "guest", guestId: "uuid-guest-helena", displayName: "Helena" },
    ]);
    expect(payload.shares).toEqual([5000, 5000]);
  });

  it("builds a single_amount expense split equally", () => {
    const store = useBillStore.getState();
    store.createExpense("Cinema", "single_amount");
    store.updateExpense({ totalAmountInput: 6000 });
    store.addParticipant(userAlice);
    store.addParticipant(userBob);
    store.addParticipant(userCarol);

    store.splitBillEqually([userAlice.id, userBob.id, userCarol.id]);
    store.setPayerFull(userAlice.id);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { header, payload } = result.value;
    expect(header.totalCents).toBe(6000);
    expect(header.merchantName).toBeNull();
    expect(header.serviceFeeBasisPoints).toBe(0);
    expect(header.fixedFeeCents).toBe(0);
    expect(payload.items).toEqual([]);
    expect(payload.shares).toEqual([2000, 2000, 2000]);
    expect(payload.itemAssignments).toBeNull();
    expect(payload.payers).toEqual([
      { participantIndex: 0, amountCents: 6000 },
    ]);
  });

  it("builds a single_amount expense split by percentage", () => {
    const store = useBillStore.getState();
    store.createExpense("Corrida de App", "single_amount", "Uber");
    store.updateExpense({ totalAmountInput: 10000 });
    store.addParticipant(userAlice);
    store.addParticipant(userBob);

    store.splitBillByPercentage([
      { userId: userAlice.id, percentage: 70 },
      { userId: userBob.id, percentage: 30 },
    ]);
    store.splitPaymentEqually([userAlice.id, userBob.id]);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = result.value;
    expect(payload.shares).toEqual([7000, 3000]);
    expect(payload.payers).toEqual([
      { participantIndex: 0, amountCents: 5000 },
      { participantIndex: 1, amountCents: 5000 },
    ]);
  });

  it("builds a single_amount expense split by fixed amounts", () => {
    const store = useBillStore.getState();
    store.createExpense("Supermercado", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.addParticipant(userAlice);
    store.addParticipant(userBob);

    store.splitBillByFixed([
      { userId: userAlice.id, amountCents: 3500 },
      { userId: userBob.id, amountCents: 1500 },
    ]);
    store.setPayerFull(userBob.id);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = result.value;
    expect(payload.shares).toEqual([3500, 1500]);
    expect(payload.payers).toEqual([
      { participantIndex: 1, amountCents: 5000 },
    ]);
  });

  it("rejects payer total mismatch with payer_total_mismatch code", () => {
    const store = useBillStore.getState();
    store.createExpense("Conta", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.addParticipant(userAlice);
    store.splitBillEqually([userAlice.id]);
    store.setPayerAmount(userAlice.id, 4000);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toEqual({ code: "payer_total_mismatch" });
  });

  it("rejects share total mismatch with share_total_mismatch code", () => {
    const store = useBillStore.getState();
    store.createExpense("Conta", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.addParticipant(userAlice);
    store.addParticipant(userBob);
    store.splitBillByFixed([
      { userId: userAlice.id, amountCents: 2000 },
      { userId: userBob.id, amountCents: 2000 },
    ]);
    store.setPayerFull(userAlice.id);

    const result = buildExpensePayload(useBillStore.getState(), "2026-09-05");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toEqual({ code: "share_total_mismatch" });
  });
});
