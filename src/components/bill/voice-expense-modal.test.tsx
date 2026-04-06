import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
