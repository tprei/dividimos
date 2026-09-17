import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";
import { ItemizedWorkspace } from "./itemized-workspace";
import type { ExpensePayer } from "@/types";

function renderPaymentGate(payers: ExpensePayer[], grandTotal: number) {
  const onFooter = vi.fn();
  const store = {
    items: [],
    participants: [],
    guests: [],
    splits: [],
    payers,
    updateExpense: vi.fn(),
    occurredOn: null,
    setOccurredOn: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    addItem: vi.fn(),
    setItemDivision: vi.fn(),
    setPayerFull: vi.fn(),
    splitPaymentEqually: vi.fn(),
    setPayerAmount: vi.fn(),
    removePayerEntry: vi.fn(),
  };
  render(
    <ItemizedWorkspace
      store={store}
      expense={null}
      occurredOn="2026-09-17"
      groupValue={null}
      dmEligible={false}
      accountReady
      titleRef={createRef<HTMLInputElement | null>()}
      section={"payment" as ItemizedSectionKey}
      onSectionChange={vi.fn()}
      amountInputs={{}}
      invalidAmountIds={[]}
      serviceFeeInput=""
      serviceFeeCents={0}
      grandTotal={grandTotal}
      partial={false}
      remainingCents={0}
      issues={[]}
      expandedId={null}
      participantsOpen={false}
      participants={{
        me: {
          id: "a",
          handle: "ana",
          name: "Ana",
          avatarUrl: null,
          email: "a@test.com",
          pixKeyType: null,
          pixKeyHint: null,
          onboarded: true,
          notificationPreferences: {},
        },
        participants: [],
        guests: [],
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
      onParticipantsOpenChange={vi.fn()}
      onAmountChange={vi.fn()}
      onServiceFeeChange={vi.fn()}
      onToggleItem={vi.fn()}
      onSaveDivision={vi.fn()}
      onCloseDivision={vi.fn()}
      onAssignSelected={vi.fn()}
      onFooter={onFooter}
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
  it("blocks an empty rateio with 'Selecione quem pagou.'", () => {
    renderPaymentGate([], 10_000);

    expect(screen.getByText("Selecione quem pagou.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("names the shortfall when paid below the grand total", () => {
    renderPaymentGate([payer("a", 5000), payer("b", 4500)], 10_000);

    expect(screen.getByRole("status")).toHaveTextContent(
      /Faltam R\$\s*5,00 para bater com o total\./,
    );
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("names the excess when paid above the grand total", () => {
    renderPaymentGate([payer("a", 10_500)], 10_000);

    expect(screen.getByRole("status")).toHaveTextContent(/Excede R\$\s*5,00 do total\./);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("enables the footer and advances when paid matches the total", () => {
    const { onFooter } = renderPaymentGate(
      [payer("a", 5000), payer("b", 5000)],
      10_000,
    );

    const button = screen.getByRole("button", { name: "Continuar" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onFooter).toHaveBeenCalledTimes(1);
  });
});
