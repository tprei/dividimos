import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemizedWorkspace } from "./itemized-workspace";
import type { ExpensePayer } from "@/types";

function renderPaymentGate(payers: ExpensePayer[], grandTotal: number) {
  const onFooter = vi.fn();
  const store = {
    items: [{ id: "i1", expenseId: "e1", description: "Pizza", quantity: 1000, unitPriceCents: grandTotal, totalPriceCents: grandTotal, createdAt: "2026-09-17" }],
    participants: [],
    guests: [],
    splits: [],
    payers,
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    addItem: vi.fn(),
    unassignItem: vi.fn(),
  };
  render(
    <ItemizedWorkspace
      store={store}
      section="payment"
      onSectionChange={vi.fn()}
      details={{
        title: "Conta",
        onTitleChange: vi.fn(),
        occurredOn: "2026-09-17",
        onOccurredOnChange: vi.fn(),
        group: null,
      }}
      payment={{
        payers: [],
        mode: "fixed",
        onModeChange: vi.fn(),
        included: payers.map((entry) => entry.userId),
        onToggle: vi.fn(),
        basisPointsById: {},
        centsById: {},
        onShareChange: vi.fn(),
        onSplitEvenly: null,
        remainderCents: 0,
        summary: [],
        itemsCents: grandTotal,
        serviceFeeCents: 0,
        fixedFeesCents: 0,
        grandTotal,
        hasGuests: false,
      }}
      amountInputs={{}}
      invalidAmountIds={[]}
      serviceFeeInput=""
      serviceFeeCents={0}
      fixedFees={0}
      grandTotal={grandTotal}
      partial={false}
      remainingCents={0}
      expandedId={null}
      participants={{
        me: {
          id: "a",
          handle: "ana",
          name: "Ana",
          avatarUrl: null,
          isBot: false,
          email: "a@test.com",
          pixKeyType: null,
          pixKeyHint: null,
          onboarded: true,
          notificationPreferences: {},
        },
        participants: [],
        guests: [{ id: "g1", name: "Gil" }, { id: "g2", name: "Gui" }],
        selectedGroupId: null,
        groups: [],
        createGroup: { enabled: false, name: "" },
        onToggleCreateGroup: vi.fn(),
        onCreateGroupName: vi.fn(),
        onSelectGroup: vi.fn(),
        onAddParticipant: vi.fn(),
        onRemoveParticipant: vi.fn(),
        onAddGuest: vi.fn(),
        onRemoveGuest: vi.fn(),
        hasContactPicker: false,
        onPickContacts: vi.fn().mockResolvedValue(undefined),
      }}
      onAmountChange={vi.fn()}
      onServiceFeeChange={vi.fn()}
      onToggleItem={vi.fn()}
      onSaveDivision={vi.fn()}
      onCloseDivision={vi.fn()}
      onAssignSelected={vi.fn()}
      onSubmit={onFooter}
      isEditing={false}
      submitting={false}
    />,
  );
  return { onFooter };
}

function payer(userId: string, amountCents: number): ExpensePayer {
  return { expenseId: "e1", userId, amountCents };
}

describe("ItemizedWorkspace payment gate", () => {
  it("blocks saving until someone is marked as having paid", () => {
    renderPaymentGate([], 10_000);

    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain("Escolha quem pagou.");
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeDisabled();
  });

  it("names the shortfall when paid below the grand total", () => {
    renderPaymentGate([payer("a", 5000), payer("b", 4500)], 10_000);

    expect(screen.getByText(/Faltam R\$\s*5,00 para bater com o total\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeDisabled();
  });

  it("names the excess when paid above the grand total", () => {
    renderPaymentGate([payer("a", 10_500)], 10_000);

    expect(screen.getByText(/Excede R\$\s*5,00 do total\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeDisabled();
  });

  it("saves when paid matches the total", () => {
    const { onFooter } = renderPaymentGate([payer("a", 5000), payer("b", 5000)], 10_000);

    const button = screen.getByRole("button", { name: "Salvar conta" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onFooter).toHaveBeenCalledTimes(1);
  });
});
