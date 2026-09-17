import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useBillStore } from "@/stores/bill-store";
import { ExpenseConflictPanel } from "./expense-conflict-panel";
import type { ExpenseDetail } from "@/types/ledger";

const mockDetail: ExpenseDetail = {
  expense: {
    id: "exp-1",
    groupId: "group-1",
    creatorId: "user-1",
    status: "active",
    currentVersionNo: 2,
    occurredOn: "2026-09-17",
    createdAt: "2026-09-17T12:00:00Z",
    deletedAt: null,
    deletedBy: null,
  },
  current: {
    expenseId: "exp-1",
    versionNo: 2,
    authorId: "user-2",
    createdAt: "2026-09-17T12:00:00Z",
    occurredOn: "2026-09-17",
    title: "Jantar Especial",
    merchantName: "Restaurante",
    expenseType: "single_amount",
    totalCents: 15000,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
    changeSummary: null,
    payload: {
      items: [],
      participants: [],
      shares: [7500, 7500],
      payers: [{ participantIndex: 0, amountCents: 15000 }],
      itemAssignments: null,
    },
  },
  versions: [],
  participants: [
    {
      participantIndex: 0,
      kind: "user",
      shareCents: 7500,
      paidCents: 15000,
      user: { id: "u1", name: "Alice", handle: "alice", avatarUrl: null },
      guest: null,
    },
    {
      participantIndex: 1,
      kind: "user",
      shareCents: 7500,
      paidCents: 0,
      user: { id: "u2", name: "Bob", handle: "bob", avatarUrl: null },
      guest: null,
    },
  ],
  group: {
    id: "group-1",
    name: "Amigos",
    kind: "group",
  },
};

describe("ExpenseConflictPanel", () => {
  it("ready renders title, description, summary Money from detail, consequence line, and enabled CTA", () => {
    render(
      <ExpenseConflictPanel
        status="ready"
        detail={mockDetail}
        onRetry={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("Esta conta foi alterada por outra pessoa enquanto você editava."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Suas alterações não podem ser salvas por cima da versão atual."),
    ).toBeInTheDocument();
    expect(screen.getByText("VERSÃO MAIS RECENTE")).toBeInTheDocument();
    expect(screen.getByText("Jantar Especial")).toBeInTheDocument();
    expect(screen.getAllByText(/150,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(
      screen.getByText("Isso substitui suas alterações pela versão mais recente."),
    ).toBeInTheDocument();

    const cta = screen.getByRole("button", { name: "Carregar versão mais recente" });
    expect(cta).toBeInTheDocument();
    expect(cta).toBeEnabled();
  });

  it("error renders ONLY retry banner and does not render summary; clicking Tentar novamente calls onRetry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <ExpenseConflictPanel
        status="error"
        detail={mockDetail}
        errorMessage="Falha ao sincronizar"
        onRetry={onRetry}
        onAccept={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Não foi possível carregar a versão mais recente."),
    ).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /tentar novamente/i });
    expect(retryBtn).toBeInTheDocument();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("VERSÃO MAIS RECENTE")).not.toBeInTheDocument();
    expect(screen.queryByText("Jantar Especial")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Isso substitui suas alterações pela versão mais recente."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Carregar versão mais recente" }),
    ).not.toBeInTheDocument();

    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("accept-while-ready fires onAccept", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();

    render(
      <ExpenseConflictPanel
        status="ready"
        detail={mockDetail}
        onRetry={vi.fn()}
        onAccept={onAccept}
      />,
    );

    const cta = screen.getByRole("button", { name: "Carregar versão mais recente" });
    await user.click(cta);

    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("onAccept while ready updates store and base version, preserving local fields during preview", async () => {
    const user = userEvent.setup();
    const store = useBillStore.getState();
    store.reset();
    store.createExpense("Rascunho Local", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });

    let editBaseVersionNo = 1;

    const handleAccept = () => {
      useBillStore.getState().hydrateFromDetail(mockDetail, []);
      editBaseVersionNo = mockDetail.expense.currentVersionNo;
    };

    render(
      <ExpenseConflictPanel
        status="ready"
        detail={mockDetail}
        onRetry={vi.fn()}
        onAccept={handleAccept}
      />,
    );

    // Preview keeps local fields intact and base version unchanged (v1)
    expect(useBillStore.getState().expense?.title).toBe("Rascunho Local");
    expect(useBillStore.getState().totalAmountInput).toBe(5000);
    expect(editBaseVersionNo).toBe(1);

    const cta = screen.getByRole("button", { name: "Carregar versão mais recente" });
    await user.click(cta);

    // After accept: store is hydrated and base version updated to candidate.currentVersionNo (v2)
    expect(editBaseVersionNo).toBe(2);
    expect(useBillStore.getState().expense?.title).toBe("Jantar Especial");
    expect(useBillStore.getState().totalAmountInput).toBe(15000);
  });

  it("loading renders warning and disabled CTA with spinner label", () => {
    render(
      <ExpenseConflictPanel
        status="loading"
        detail={null}
        onRetry={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("VERSÃO MAIS RECENTE")).not.toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /carregando/i });
    expect(cta).toBeDisabled();
  });
});
