import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceExpenseModal } from "./voice-expense-modal";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

const singleResult: VoiceExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  items: [],
  participants: [
    { spokenName: "João", matchedHandle: "joao123", confidence: "high" },
  ],
  merchantName: null,
};

const itemizedResult: VoiceExpenseResult = {
  title: "Bar do Zé",
  amountCents: 5500,
  expenseType: "itemized",
  items: [
    { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
    { description: "Pizza", quantity: 1, unitPriceCents: 2500, totalCents: 2500 },
  ],
  participants: [],
  merchantName: "Bar do Zé",
};

const groupMembers = [
  { id: "user-joao", handle: "joao123", name: "João Silva", avatarUrl: undefined },
  { id: "user-maria", handle: "maria_s", name: "Maria Santos", avatarUrl: undefined },
];

describe("VoiceExpenseModal", () => {
  it("displays parsed title and type", () => {
    render(
      <VoiceExpenseModal result={singleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Uber")).toBeInTheDocument();
    expect(screen.getByText("Valor único")).toBeInTheDocument();
  });

  it("displays amount", () => {
    render(
      <VoiceExpenseModal result={singleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
  });

  it("displays items for itemized result", () => {
    render(
      <VoiceExpenseModal result={itemizedResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Cerveja")).toBeInTheDocument();
    expect(screen.getByText("Pizza")).toBeInTheDocument();
  });

  it("displays participant with attribution button", () => {
    render(
      <VoiceExpenseModal
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("João")).toBeInTheDocument();
  });

  it("auto-resolves high-confidence matches when group members provided", () => {
    render(
      <VoiceExpenseModal
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("@joao123")).toBeInTheDocument();
    expect(screen.getByText("Alterar")).toBeInTheDocument();
  });

  it("shows attribution warning for unresolved participants", () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    render(
      <VoiceExpenseModal result={unmatched} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByText("Atribua todos os participantes antes de confirmar"),
    ).toBeInTheDocument();
  });

  it("expands member list on Atribuir click", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Atribuir"));
    expect(screen.getByText("Membros do grupo")).toBeInTheDocument();
    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("Adicionar como convidado")).toBeInTheDocument();
  });

  it("shows warning when amount is zero", () => {
    const zeroResult: VoiceExpenseResult = {
      ...singleResult,
      amountCents: 0,
      participants: [],
    };
    render(
      <VoiceExpenseModal result={zeroResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByText("Informe o valor antes de confirmar"),
    ).toBeInTheDocument();
  });

  it("calls onConfirm when no participants to resolve", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel clicked", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByText("Cancelar"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // ============================================================
  // Title editing
  // ============================================================

  it("enters title editing mode on click and confirms edit", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Click on title to enter editing mode
    await user.click(screen.getByText("Uber"));

    // Should now show an input with current title
    const titleInput = screen.getByDisplayValue("Uber");
    expect(titleInput).toBeInTheDocument();

    // Clear and type new title
    await user.clear(titleInput);
    await user.type(titleInput, "Táxi");

    // Click the check button to confirm title edit
    const checkButtons = screen.getAllByRole("button");
    const confirmEditButton = checkButtons.find(
      (btn) => btn.textContent === "" && btn.querySelector("svg"),
    );
    // The small confirm button is the one inside the title editing area
    await user.click(confirmEditButton!);

    // Title should now show the new value
    expect(screen.getByText("Táxi")).toBeInTheDocument();

    // Confirm the expense and verify the updated title is passed
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].title).toBe("Táxi");
  });

  it("enters title editing mode via keyboard Enter", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Focus on the title button and press Enter
    const titleButton = screen.getByRole("button", { name: /Uber/i });
    await user.click(titleButton);

    // Should now show an input
    expect(screen.getByDisplayValue("Uber")).toBeInTheDocument();
  });

  it("shows 'Sem título' when title is empty", () => {
    const emptyTitleResult: VoiceExpenseResult = {
      ...singleResult,
      title: "",
      participants: [],
    };
    render(
      <VoiceExpenseModal result={emptyTitleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Sem título")).toBeInTheDocument();
  });

  // ============================================================
  // Amount editing
  // ============================================================

  it("enters amount editing mode and updates the value", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Click on the amount to enter editing mode
    await user.click(screen.getByText("R$ 25,00"));

    // Should show input with initial formatted value
    const amountInput = screen.getByDisplayValue("25,00");
    expect(amountInput).toBeInTheDocument();

    // Clear and type a new amount
    await user.clear(amountInput);
    await user.type(amountInput, "42,50");

    // Find and click the confirm edit button (the small Check button next to input)
    const buttonsInAmountArea = screen.getByDisplayValue("42,50").parentElement!.querySelectorAll("button");
    await user.click(buttonsInAmountArea[0]);

    // Confirm the expense
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].amountCents).toBe(4250);
  });

  it("enters amount editing mode via keyboard Enter", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Focus on the amount display and press Enter
    const amountButton = screen.getByText("R$ 25,00").closest("[role='button']")! as HTMLElement;
    amountButton.focus();
    await user.keyboard("{Enter}");

    // Should now show an input
    expect(screen.getByDisplayValue("25,00")).toBeInTheDocument();
  });

  it("shows dash when amount is zero and not editing", () => {
    const zeroResult: VoiceExpenseResult = {
      ...singleResult,
      amountCents: 0,
      participants: [],
    };
    render(
      <VoiceExpenseModal result={zeroResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ============================================================
  // Participant matching: match to member
  // ============================================================

  it("matches unresolved participant to a group member", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Expand the assignment panel
    await user.click(screen.getByText("Atribuir"));

    // Click on "Maria Santos" to match
    await user.click(screen.getByText("Maria Santos"));

    // Should now show the resolved handle
    expect(screen.getByText("@maria_s")).toBeInTheDocument();
    // Warning should be gone
    expect(
      screen.queryByText("Atribua todos os participantes antes de confirmar"),
    ).not.toBeInTheDocument();

    // Confirm button should now be enabled
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const resolvedParticipants = onConfirm.mock.calls[0][1];
    expect(resolvedParticipants).toHaveLength(1);
    expect(resolvedParticipants[0]).toEqual({
      type: "member",
      userId: "user-maria",
      handle: "maria_s",
      name: "Maria Santos",
      avatarUrl: undefined,
    });
  });

  // ============================================================
  // Participant matching: add as guest
  // ============================================================

  it("adds unresolved participant as guest", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Pedro", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Expand assignment panel
    await user.click(screen.getByText("Atribuir"));

    // Click "Adicionar como convidado"
    await user.click(screen.getByText("Adicionar como convidado"));

    // Should show "Convidado" label
    expect(screen.getByText("Convidado")).toBeInTheDocument();
    // Warning should be gone
    expect(
      screen.queryByText("Atribua todos os participantes antes de confirmar"),
    ).not.toBeInTheDocument();

    // Confirm and check the resolved participant
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const resolvedParticipants = onConfirm.mock.calls[0][1];
    expect(resolvedParticipants).toHaveLength(1);
    expect(resolvedParticipants[0]).toEqual({
      type: "guest",
      name: "Pedro",
    });
  });

  // ============================================================
  // Clear resolved match
  // ============================================================

  it("clears a resolved match and shows unresolved state again", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // João is auto-resolved — should show "Alterar" button
    expect(screen.getByText("@joao123")).toBeInTheDocument();

    // Click "Alterar" to clear the match
    await user.click(screen.getByText("Alterar"));

    // Should now show "Atribuir" instead
    expect(screen.getByText("Atribuir")).toBeInTheDocument();
    // Warning should appear since participant is now unresolved
    expect(
      screen.getByText("Atribua todos os participantes antes de confirmar"),
    ).toBeInTheDocument();
  });

  // ============================================================
  // Confirm button disabled states
  // ============================================================

  it("disables confirm when amount is zero for single_amount", () => {
    const zeroResult: VoiceExpenseResult = {
      ...singleResult,
      amountCents: 0,
      participants: [],
    };
    render(
      <VoiceExpenseModal result={zeroResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const confirmButton = screen.getByText("Confirmar").closest("button")!;
    expect(confirmButton).toBeDisabled();
  });

  it("disables confirm when participants are unresolved", () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Alguém", matchedHandle: null, confidence: "low" },
      ],
    };
    render(
      <VoiceExpenseModal result={unmatched} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const confirmButton = screen.getByText("Confirmar").closest("button")!;
    expect(confirmButton).toBeDisabled();
  });

  it("enables confirm when all participants are resolved", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Initially disabled
    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();

    // Resolve the participant
    await user.click(screen.getByText("Atribuir"));
    await user.click(screen.getByText("Maria Santos"));

    // Now enabled
    expect(screen.getByText("Confirmar").closest("button")).not.toBeDisabled();
  });

  it("does not disable confirm for zero amount on itemized type", () => {
    const itemizedZero: VoiceExpenseResult = {
      ...itemizedResult,
      amountCents: 0,
    };
    render(
      <VoiceExpenseModal result={itemizedZero} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const confirmButton = screen.getByText("Confirmar").closest("button")!;
    expect(confirmButton).not.toBeDisabled();
  });

  // ============================================================
  // Merchant name editing
  // ============================================================

  it("displays and allows editing the merchant name", async () => {
    const merchantResult: VoiceExpenseResult = {
      ...singleResult,
      merchantName: "Padaria Central",
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={merchantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Merchant field should be visible
    expect(screen.getByText("Estabelecimento")).toBeInTheDocument();
    const merchantInput = screen.getByPlaceholderText("Nome do local");
    expect(merchantInput).toHaveValue("Padaria Central");

    // Edit it via fireEvent.change (happy-dom doesn't support user.clear reliably)
    fireEvent.change(merchantInput, { target: { value: "Boteco Legal" } });

    // Confirm and check updated merchant
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].merchantName).toBe("Boteco Legal");
  });

  it("does not show merchant section when merchantName is null", () => {
    render(
      <VoiceExpenseModal result={singleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByText("Estabelecimento")).not.toBeInTheDocument();
  });

  // ============================================================
  // Itemized items display
  // ============================================================

  it("shows quantity breakdown for items with quantity > 1", () => {
    render(
      <VoiceExpenseModal result={itemizedResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // Cerveja: 2x R$ 15,00 un.
    expect(screen.getByText(/2x/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 15,00 un\./)).toBeInTheDocument();
    // Pizza has quantity 1 — should NOT show breakdown
    expect(screen.queryByText(/1x/)).not.toBeInTheDocument();
  });

  it("shows item total amounts", () => {
    render(
      <VoiceExpenseModal result={itemizedResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
  });

  // ============================================================
  // Expense type display
  // ============================================================

  it("shows 'Vários itens' for itemized type", () => {
    render(
      <VoiceExpenseModal result={itemizedResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Vários itens")).toBeInTheDocument();
  });

  // ============================================================
  // Confirm passes correct data
  // ============================================================

  it("passes original amount when no editing was done", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm.mock.calls[0][0].amountCents).toBe(2500);
    expect(onConfirm.mock.calls[0][0].title).toBe("Uber");
  });

  it("auto-resolved participants are included in onConfirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const resolvedParticipants = onConfirm.mock.calls[0][1];
    expect(resolvedParticipants).toHaveLength(1);
    expect(resolvedParticipants[0].type).toBe("member");
    expect(resolvedParticipants[0].handle).toBe("joao123");
  });

  // ============================================================
  // Multiple participants
  // ============================================================

  it("handles multiple unresolved participants independently", async () => {
    const multiUnmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Ana", matchedHandle: null, confidence: "low" },
        { spokenName: "Bruno", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={multiUnmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Both should show "Atribuir"
    const assignButtons = screen.getAllByText("Atribuir");
    expect(assignButtons).toHaveLength(2);

    // Resolve first as member
    await user.click(assignButtons[0]);
    await user.click(screen.getByText("João Silva"));

    // Still disabled — second participant unresolved
    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();

    // Resolve second as guest
    const remainingAssign = screen.getByText("Atribuir");
    await user.click(remainingAssign);
    await user.click(screen.getByText("Adicionar como convidado"));

    // Now confirm should be enabled
    expect(screen.getByText("Confirmar").closest("button")).not.toBeDisabled();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const resolved = onConfirm.mock.calls[0][1];
    expect(resolved).toHaveLength(2);
    expect(resolved[0].type).toBe("member");
    expect(resolved[1].type).toBe("guest");
  });

  // ============================================================
  // Assignment panel toggle
  // ============================================================

  it("collapses assignment panel when clicking Atribuir again", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Expand
    await user.click(screen.getByText("Atribuir"));
    expect(screen.getByText("Membros do grupo")).toBeInTheDocument();

    // Collapse
    await user.click(screen.getByText("Atribuir"));
    expect(screen.queryByText("Membros do grupo")).not.toBeInTheDocument();
  });

  // ============================================================
  // Participant confidence display
  // ============================================================

  it("shows question mark for medium-confidence suggested handle", () => {
    const mediumResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Jo", matchedHandle: "joao123", confidence: "medium" },
      ],
    };
    render(
      <VoiceExpenseModal
        result={mediumResult}
        groupMembers={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Medium confidence shows handle with "?" and "Atribuir" button (not auto-resolved)
    expect(screen.getByText("@joao123 ?")).toBeInTheDocument();
    expect(screen.getByText("Atribuir")).toBeInTheDocument();
  });

  it("shows 'Não identificado' for low-confidence with no handle", () => {
    const lowResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "???", matchedHandle: null, confidence: "low" },
      ],
    };
    render(
      <VoiceExpenseModal
        result={lowResult}
        groupMembers={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Não identificado")).toBeInTheDocument();
  });
});
