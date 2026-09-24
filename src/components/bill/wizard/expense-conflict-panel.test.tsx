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
        user: { id: "u1", name: "Alice", handle: "alice", avatarUrl: null, isBot: false },
        guest: null,
      },
      {
        participantIndex: 1,
        kind: "user",
        shareCents: 11845,
        paidCents: 0,
        user: { id: "u2", name: "Bob", handle: "bob", avatarUrl: null, isBot: false },
        guest: null,
      },
    ],
    group: { id: "group-1", name: "Amigos", kind: "group" },
  };
}

describe("ExpenseConflictPanel", () => {
  it("focuses the conflict and loads the latest version only on request", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Carregar versão mais recente" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });


  it("disables the action while the latest version is loading", () => {
    render(
      <ExpenseConflictPanel status="loading" detail={null} onRetry={vi.fn()} onAccept={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /Carregando/ })).toBeDisabled();
  });

  it("turns the action into a retry when loading failed", async () => {
    const onRetry = vi.fn();
    const onAccept = vi.fn();
    render(
      <ExpenseConflictPanel status="error" detail={null} onRetry={onRetry} onAccept={onAccept} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
