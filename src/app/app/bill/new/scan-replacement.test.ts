import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { buildExpensePayload } from "@/lib/ledger/payload";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { User } from "@/types";
import { buildScanDraftCandidate } from "./scan-replacement";
import { commitScanReplacement } from "./scan-commit";

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

const sampleOcrResult: ReceiptOcrResult = {
  merchant: "Bar do Zé",
  items: [
    {
      description: "Cerveja Brahma 600ml",
      quantity: 2000,
      unitPriceCents: 1200,
      totalCents: 2400,
    },
    {
      description: "Picanha 400g",
      quantity: 1000,
      unitPriceCents: 4500,
      totalCents: 4500,
    },
  ],
  serviceFeeBasisPoints: 1000,
  fixedFeesCents: 200,
  totalCents: 7790, // 6900 + 690 (10%) + 200 = 7790
};

describe("scan-replacement & scan-commit", () => {
  beforeEach(() => {
    localStorage.clear();
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: userAlice });
  });

  afterEach(() => {
    localStorage.clear();
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: null });
  });

  it("seeds single_amount draft and commits replacement in exactly ONE store transition and localStorage snapshot", () => {
    // 1. Seed complete single_amount draft
    const store = useBillStore.getState();
    store.createExpense("Aluguel Antigo", "single_amount", undefined, "group-1");
    store.updateExpense({ totalAmountInput: 150000 });
    store.addParticipant(userAlice);
    store.splitBillEqually([userAlice.id]);
    store.setPayerFull(userAlice.id);
    store.setOccurredOn("2026-09-01");

    const oldDraftKey = useBillStore.getState().draftKey;
    const oldExpenseId = useBillStore.getState().expense?.id;
    expect(oldDraftKey).toBeDefined();

    // Verify localStorage has the old draft
    const oldPersistedJson = localStorage.getItem("dividimos-draft");
    expect(oldPersistedJson).not.toBeNull();
    const oldPersisted = JSON.parse(oldPersistedJson!);
    expect(oldPersisted.state.expense.expenseType).toBe("single_amount");
    expect(oldPersisted.state.totalAmountInput).toBe(150000);

    // 2. Build candidate from OCR
    const candidate = buildScanDraftCandidate({
      result: sampleOcrResult,
      occurredOn: "2026-09-17",
      groupId: "group-1",
      participants: [userAlice, userBob],
      guests: [],
      creatorId: userAlice.id,
      nowIso: "2026-09-17T12:00:00Z",
    });

    // 3. Attach store subscriber to count transitions
    let storeTransitions = 0;
    const unsubscribe = useBillStore.subscribe(() => {
      storeTransitions++;
    });

    // 4. Commit replacement
    commitScanReplacement(candidate);
    unsubscribe();

    // Exactly ONE transition
    expect(storeTransitions).toBe(1);

    // Verify store state immediately matches candidate completely
    const nextState = useBillStore.getState();
    expect(nextState.expense).not.toBeNull();
    expect(nextState.expense!.id).toBe(candidate.expense.id);
    expect(nextState.expense!.id).not.toBe(oldExpenseId);
    expect(nextState.expense!.expenseType).toBe("itemized");
    expect(nextState.expense!.title).toBe("Bar do Zé");
    expect(nextState.expense!.merchantName).toBe("Bar do Zé");
    expect(nextState.expense!.groupId).toBe("group-1");
    expect(nextState.expense!.serviceFeeBasisPoints).toBe(1000);
    expect(nextState.expense!.fixedFees).toBe(200);
    expect(nextState.occurredOn).toBe("2026-09-17");
    expect(nextState.totalAmountInput).toBe(0);
    expect(nextState.items).toHaveLength(2);
    expect(nextState.items[0].totalPriceCents).toBe(2400);
    expect(nextState.items[1].totalPriceCents).toBe(4500);
    expect(nextState.participants).toHaveLength(2);
    expect(nextState.guests).toEqual([]);
    expect(nextState.payers).toEqual([]);
    expect(nextState.splits).toEqual([]);
    expect(nextState.billSplits).toEqual([]);
    expect(nextState.draftKey).not.toBe(oldDraftKey);
    expect(nextState.receiptAccessKey).toBeNull();

    // Verify localStorage snapshot reflects the new complete state without intermediate states
    const nextPersistedJson = localStorage.getItem("dividimos-draft");
    expect(nextPersistedJson).not.toBeNull();
    const nextPersisted = JSON.parse(nextPersistedJson!);
    expect(nextPersisted.state.expense.expenseType).toBe("itemized");
    expect(nextPersisted.state.items).toHaveLength(2);
    expect(nextPersisted.state.occurredOn).toBe("2026-09-17");
    expect(nextPersisted.state.payers).toEqual([]);
    expect(nextPersisted.state.splits).toEqual([]);
    expect(nextPersisted.state.billSplits).toEqual([]);
    expect(nextPersisted.state.totalAmountInput).toBe(0);
  });

  it("leaves payload unchanged along the cancelled path", () => {
    // Seed existing draft
    const store = useBillStore.getState();
    store.createExpense("Almoço Existente", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.addParticipant(userAlice);
    store.splitBillEqually([userAlice.id]);
    store.setPayerFull(userAlice.id);
    store.setOccurredOn("2026-09-15");

    const prePayload = buildExpensePayload(useBillStore.getState(), "2026-09-15");
    expect(prePayload.ok).toBe(true);

    // Build candidate (review stage)
    const candidate = buildScanDraftCandidate({
      result: sampleOcrResult,
      occurredOn: "2026-09-17",
      groupId: null,
      participants: [userAlice],
      guests: [],
      creatorId: userAlice.id,
      nowIso: "2026-09-17T12:00:00Z",
    });
    expect(candidate.items).toHaveLength(2);

    // Cancelled path: candidate is dropped, no commit
    const postPayload = buildExpensePayload(useBillStore.getState(), "2026-09-15");
    expect(postPayload.ok).toBe(true);
    expect(postPayload).toEqual(prePayload);
  });

  it("builds valid expense payload on committed state with items-derived total", () => {
    const candidate = buildScanDraftCandidate({
      result: sampleOcrResult,
      occurredOn: "2026-09-17",
      groupId: null,
      participants: [userAlice, userBob],
      guests: [],
      creatorId: userAlice.id,
      nowIso: "2026-09-17T12:00:00Z",
    });

    commitScanReplacement(candidate);

    const store = useBillStore.getState();
    expect(store.items).toHaveLength(2);

    // Assign items and payer to make the draft payload complete
    store.splitItemEqually(store.items[0].id, [userAlice.id, userBob.id]);
    store.splitItemEqually(store.items[1].id, [userAlice.id]);
    store.setPayerFull(userAlice.id);

    const result = buildExpensePayload(useBillStore.getState(), store.occurredOn!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Items total: 2400 + 4500 = 6900
    // 10% fee on 6900 = 690
    // Fixed fee = 200
    // Grand total = 7790
    expect(result.value.header.expenseType).toBe("itemized");
    expect(result.value.header.totalCents).toBe(7790);
    expect(result.value.header.serviceFeeBasisPoints).toBe(1000);
    expect(result.value.header.fixedFeeCents).toBe(200);
    expect(result.value.header.title).toBe("Bar do Zé");
    expect(result.value.payload.items).toHaveLength(2);
    expect(result.value.payload.items[0].totalPriceCents).toBe(2400);
    expect(result.value.payload.items[1].totalPriceCents).toBe(4500);
  });
});
