import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob } from "@/test/fixtures";
import { LedgerError } from "@/lib/sync/errors";
import { useWizardSubmit } from "./use-wizard-submit";

const { mockCreateExpense, mockEditExpense } = vi.hoisted(() => ({
  mockCreateExpense: vi.fn(),
  mockEditExpense: vi.fn(),
}));

vi.mock("@/lib/sync/mutations", () => ({
  createExpense: mockCreateExpense,
  editExpense: mockEditExpense,
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
  const onStaleReload = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
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
        onStaleReload,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => "group-1");
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
        onStaleReload,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.submit(async () => "group-1");
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

  it("stale_version surfaces the reload toast and wires reload action", async () => {
    setupValidSingleExpense();
    mockEditExpense.mockRejectedValueOnce(new LedgerError("stale_version"));

    const { result } = renderHook(() =>
      useWizardSubmit({
        router,
        editExpenseId: "exp-edit-1",
        expectedVersionNo: 2,
        onStaleReload,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => "group-1");
    });

    expect(ok).toBe(false);
    expect(mockToast.custom).toHaveBeenCalledOnce();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(onStaleReload).not.toHaveBeenCalled();

    // The toast renders a node with the prompt and a "Recarregar" button.
    const renderToast = mockToast.custom.mock.calls[0][0];
    const node = renderToast({ id: "toast-1" }) as ReactElement<{
      children: [ReactElement<{ children: string }>, ReactElement<{ onClick: () => void }>];
    }>;
    expect(node.props.children[0].props.children).toBe(
      "Alguém editou essa conta enquanto você mexia. Recarregar?",
    );

    // Clicking the toast button triggers reload and dismisses the toast.
    await act(async () => {
      node.props.children[1].props.onClick();
    });
    expect(mockToast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(onStaleReload).toHaveBeenCalledOnce();
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
        onStaleReload,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => "group-1");
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
        onStaleReload,
      }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.submit(async () => null);
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
        onStaleReload,
      }),
    );

    const results: boolean[] = [];
    await act(async () => {
      const attempts = [
        result.current.submit(async () => "group-1"),
        result.current.submit(async () => "group-1"),
        result.current.submit(async () => "group-1"),
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
        onStaleReload,
      }),
    );

    await act(async () => {
      await result.current.submit(async () => "group-1");
    });
    await act(async () => {
      await result.current.submit(async () => "group-1");
    });

    expect(draftKey).toBeTruthy();
    expect(mockCreateExpense.mock.calls[0][0].clientId).toBe(draftKey);
    expect(mockCreateExpense.mock.calls[1][0].clientId).toBe(draftKey);
  });
});
