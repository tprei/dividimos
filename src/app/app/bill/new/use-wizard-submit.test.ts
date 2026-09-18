import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob } from "@/test/fixtures";
import { LedgerError } from "@/lib/sync/errors";
import { planGroup, useWizardSubmit } from "./use-wizard-submit";
import { readDraftIntent, writeDraftIntent } from "@/lib/draft-intent";

const { mockCreateExpense, mockCreateExpenseWithGroup, mockEditExpense } = vi.hoisted(() => ({
  mockCreateExpense: vi.fn(),
  mockCreateExpenseWithGroup: vi.fn(),
  mockEditExpense: vi.fn(),
}));

const { mockGetOrCreateDm } = vi.hoisted(() => ({
  mockGetOrCreateDm: vi.fn(),
}));

vi.mock("@/lib/sync/mutations", () => ({
  createExpense: mockCreateExpense,
  createExpenseWithGroup: mockCreateExpenseWithGroup,
  editExpense: mockEditExpense,
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  getOrCreateDm: mockGetOrCreateDm,
}));
const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: mockToast,
}));

function setupValidSingleExpense() {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense("Jantar", "single_amount");
  store.updateExpense({ totalAmountInput: 10000 });
  store.addParticipant(userBob);
  store.splitBillEqually(["user-alice", "user-bob"]);
  store.setPayerFull("user-alice");
  store.setOccurredOn("2026-09-06");
}

describe("useWizardSubmit", () => {
  const router = { push: vi.fn() };
  const onStaleVersion = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useBillStore.getState().reset();
  });

  it("create path calls createExpense with payload from buildExpensePayload and resets store", async () => {
    setupValidSingleExpense();
    const draftKey = useBillStore.getState().draftKey;
    mockCreateExpense.mockResolvedValueOnce({
      groupId: "group-1",
      ledgerVersion: 1,
      eventId: 42,
      expenseId: "exp-created-1",
    });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(ok).toBe(true);
    expect(mockCreateExpense).toHaveBeenCalledOnce();
    const [call] = mockCreateExpense.mock.calls;
    expect(call[0].clientId).toBe(draftKey);
    expect(call[0].groupId).toBe("group-1");
    expect(call[0].header).toMatchObject({
      occurredOn: "2026-09-06",
      title: "Jantar",
      totalCents: 10000,
      expenseType: "single_amount",
    });
    expect(call[0].payload.shares).toEqual([5000, 5000]);
    expect(call[0].payload.participants).toEqual([
      { kind: "user", userId: "user-alice" },
      { kind: "user", userId: "user-bob" },
    ]);
    expect(router.push).toHaveBeenCalledWith("/app/bill/exp-created-1");
    expect(useBillStore.getState().expense).toBeNull();
  });

  it("edit path passes expectedVersionNo to editExpense and navigates to the bill", async () => {
    setupValidSingleExpense();
    mockEditExpense.mockResolvedValueOnce({
      groupId: "group-1",
      ledgerVersion: 3,
      eventId: 43,
      expenseId: "exp-edit-1",
    });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: "exp-edit-1",
        expectedVersionNo: 2,
        onStaleVersion,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(ok).toBe(true);
    expect(mockCreateExpense).not.toHaveBeenCalled();
    expect(mockEditExpense).toHaveBeenCalledOnce();
    const [call] = mockEditExpense.mock.calls;
    expect(call[0].expenseId).toBe("exp-edit-1");
    expect(call[0].expectedVersionNo).toBe(2);
    expect(call[0].header.occurredOn).toBe("2026-09-06");
    expect(router.push).toHaveBeenCalledWith("/app/bill/exp-edit-1");
  });

  it("uses expectedVersionNo from draft intent when editing and expectedVersionNo prop is null, and clears intent on success", async () => {
    setupValidSingleExpense();
    const expenseId = useBillStore.getState().expense!.id;
    writeDraftIntent({
      kind: "edit",
      expenseId,
      expectedVersionNo: 5,
      draftKey: useBillStore.getState().draftKey,
    });

    mockEditExpense.mockResolvedValueOnce({
      groupId: "group-1",
      ledgerVersion: 6,
      eventId: 44,
      expenseId,
    });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: expenseId,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(ok).toBe(true);
    expect(mockEditExpense).toHaveBeenCalledOnce();
    const [call] = mockEditExpense.mock.calls;
    expect(call[0].expectedVersionNo).toBe(5);
    expect(readDraftIntent()).toBeNull();
  });


  it("stale_version calls onStaleVersion and does not toast", async () => {
    setupValidSingleExpense();
    mockEditExpense.mockRejectedValueOnce(new LedgerError("stale_version"));

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: "exp-edit-1",
        expectedVersionNo: 2,
        onStaleVersion,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(ok).toBe(false);
    expect(onStaleVersion).toHaveBeenCalledOnce();
    expect(mockToast.custom).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("validation failure toasts and does not call the RPC", async () => {
    // Incomplete expense: no payer assigned, shares don't match payer total.
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createExpense("Jantar", "single_amount");
    store.updateExpense({ totalAmountInput: 10000 });
    store.addParticipant(userBob);
    store.splitBillEqually(["user-alice", "user-bob"]);
    // deliberately omit setPayerFull so payer total (0) !== total (10000)

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(ok).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("O pagamento não bate com o total da conta.");
    expect(mockCreateExpense).not.toHaveBeenCalled();
    expect(mockEditExpense).not.toHaveBeenCalled();
    expect(useBillStore.getState().expense).not.toBeNull();
  });

  it("toasts when submitting a new expense with no group", async () => {
    setupValidSingleExpense();

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => ({ kind: "none" }));
    });

    expect(ok).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("Escolha um grupo para dividir a conta.");
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("creates one expense when the submit button is spammed", async () => {
    setupValidSingleExpense();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockCreateExpense.mockImplementation(async () => {
      await gate;
      return { groupId: "group-1", ledgerVersion: 1, eventId: 1, expenseId: "exp-1" };
    });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    const results: boolean[] = [];
    await act(async () => {
      const attempts = [
        result.current.submit(async () => ({ kind: "existing", groupId: "group-1" })),
        result.current.submit(async () => ({ kind: "existing", groupId: "group-1" })),
        result.current.submit(async () => ({ kind: "existing", groupId: "group-1" })),
      ];
      release?.();
      results.push(...(await Promise.all(attempts)));
    });

    expect(mockCreateExpense).toHaveBeenCalledOnce();
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("sends the draft key as the client id so a retry cannot duplicate the bill", async () => {
    setupValidSingleExpense();
    const draftKey = useBillStore.getState().draftKey;
    mockCreateExpense.mockRejectedValueOnce(new LedgerError("network"));
    mockCreateExpense.mockResolvedValueOnce({
      groupId: "group-1",
      ledgerVersion: 1,
      eventId: 1,
      expenseId: "exp-1",
    });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    await act(async () => {
      await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });
    await act(async () => {
      await result.current.submit(async () => ({ kind: "existing", groupId: "group-1" }));
    });

    expect(draftKey).toBeTruthy();
    expect(mockCreateExpense.mock.calls[0][0].clientId).toBe(draftKey);
    expect(mockCreateExpense.mock.calls[1][0].clientId).toBe(draftKey);
  });

  it("writes a new group and its bill in one call", async () => {
    setupValidSingleExpense();
    mockCreateExpenseWithGroup.mockResolvedValue({ expenseId: "exp-1", groupId: "g-new" });

    const { result } = renderHook(() =>
      useWizardSubmit({
        router: router as unknown as Parameters<typeof useWizardSubmit>[0]["router"],
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => ({
        kind: "create",
        name: "Viagem",
        memberIds: ["user-bob"],
      }));
    });

    expect(ok).toBe(true);
    // One call, so there is no window in which a group exists without a bill.
    expect(mockCreateExpense).not.toHaveBeenCalled();
    expect(mockCreateExpenseWithGroup).toHaveBeenCalledOnce();
    expect(mockCreateExpenseWithGroup.mock.calls[0][0]).toMatchObject({
      groupName: "Viagem",
      memberIds: ["user-bob"],
    });
    expect(router.push).toHaveBeenCalledWith("/app/bill/exp-1");
  });

  it("keeps the draft and creates nothing when the combined write fails", async () => {
    setupValidSingleExpense();
    const draftKey = useBillStore.getState().draftKey;
    mockCreateExpenseWithGroup.mockRejectedValue(new LedgerError("unknown"));

    const { result } = renderHook(() =>
      useWizardSubmit({
        router: router as unknown as Parameters<typeof useWizardSubmit>[0]["router"],
        editExpenseId: null,
        expectedVersionNo: null,
        onStaleVersion,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => ({
        kind: "create",
        name: "Viagem",
        memberIds: ["user-bob"],
      }));
    });

    expect(ok).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    // The draft survives with its client id, so a retry is the same write.
    expect(useBillStore.getState().draftKey).toBe(draftKey);
    expect(useBillStore.getState().expense?.title).toBe("Jantar");
  });

  it("planGroup targets store expense.groupId without DM auto-targeting when 1 counterparty is present", async () => {
    setupValidSingleExpense();
    useBillStore.getState().updateExpense({ groupId: "group-praia" });
    const plan = await planGroup({
      meId: userAlice.id,
      createGroupEnabled: true,
      createGroupName: "",
      defaultGroupName: "",
    });
    expect(plan).toEqual({ kind: "existing", groupId: "group-praia" });
    expect(mockGetOrCreateDm).not.toHaveBeenCalled();
  });
});
