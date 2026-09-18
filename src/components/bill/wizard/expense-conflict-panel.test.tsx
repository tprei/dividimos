import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExpenseConflictPanel } from "./expense-conflict-panel";
import type { ExpenseDetail } from "@/types/ledger";

function makeDetail(overrides: Partial<ExpenseDetail["current"]> = {}): ExpenseDetail {
  return {
    expense: {
      id: "exp-1",
      groupId: "group-1",
      creatorId: "u1",
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
      authorId: "u2",
      createdAt: "2026-09-17T12:00:00Z",
      occurredOn: "2026-09-17",
      title: "Churrasco atualizado",
      merchantName: null,
      expenseType: "single_amount",
      totalCents: 23690,
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      changeSummary: {
        title: ["Churrasco", "Churrasco atualizado"],
        totalCents: [20000, 23690],
        participantsAdded: [],
        participantsRemoved: [],
        payersChanged: false,
      },
      payload: {
        items: [],
        participants: [],
        shares: [11845, 11845],
        payers: [{ participantIndex: 0, amountCents: 23690 }],
        itemAssignments: null,
      },
      ...overrides,
    },
    versions: [],
    participants: [
      {
        participantIndex: 0,
        kind: "user",
        shareCents: 11845,
        paidCents: 23690,
        user: { id: "u1", name: "Alice", handle: "alice", avatarUrl: null },
        guest: null,
      },
      {
        participantIndex: 1,
        kind: "user",
        shareCents: 11845,
        paidCents: 0,
        user: { id: "u2", name: "Bob", handle: "bob", avatarUrl: null },
        guest: null,
      },
    ],
    group: { id: "group-1", name: "Amigos", kind: "group" },
  };
}

describe("ExpenseConflictPanel", () => {
  it("names the author and lists what changed in a single card", async () => {
    const onAccept = vi.fn();
    render(
      <ExpenseConflictPanel
        status="ready"
        detail={makeDetail()}
        onRetry={vi.fn()}
        onAccept={onAccept}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Bob alterou esta conta enquanto você editava" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bob mudou o nome de “Churrasco” para “Churrasco atualizado”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bob mudou o total de R$ 200,00 para R$ 236,90"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Editado em /)).toBeInTheDocument();
    expect(screen.getByText("Carregar substitui o que você digitou.")).toBeInTheDocument();
    // The per-participant share table is gone: only the change summary remains.
    expect(screen.queryByText("R$ 118,45")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Carregar versão mais recente" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic heading and sentence when the author is unknown", () => {
    render(
      <ExpenseConflictPanel
        status="ready"
        detail={makeDetail({ authorId: "someone-else", changeSummary: null })}
        onRetry={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Esta conta mudou enquanto você editava" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alguém editou a conta")).toBeInTheDocument();
  });

  it("disables the action while the latest version is loading", () => {
    render(
      <ExpenseConflictPanel status="loading" detail={null} onRetry={vi.fn()} onAccept={vi.fn()} />,
    );

    expect(screen.getByText("Carregando a versão mais recente...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Carregando/ })).toBeDisabled();
  });

  it("turns the action into a retry when loading failed", async () => {
    const onRetry = vi.fn();
    const onAccept = vi.fn();
    render(
      <ExpenseConflictPanel status="error" detail={null} onRetry={onRetry} onAccept={onAccept} />,
    );

    expect(
      screen.getByText("Não deu pra carregar a versão mais recente. Suas edições continuam aqui."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
