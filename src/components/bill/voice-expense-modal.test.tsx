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

describe("VoiceExpenseModal", () => {
  it("displays parsed title and amount", () => {
    render(
      <VoiceExpenseModal
        open={true}
        result={singleResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Uber")).toBeInTheDocument();
    expect(screen.getByText("Valor único")).toBeInTheDocument();
    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
  });

  it("displays items for itemized result", () => {
    render(
      <VoiceExpenseModal
        open={true}
        result={itemizedResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/2x Cerveja/)).toBeInTheDocument();
    expect(screen.getByText(/1x Pizza/)).toBeInTheDocument();
    expect(screen.getByText("Vários itens")).toBeInTheDocument();
  });

  it("displays merchant name when present", () => {
    render(
      <VoiceExpenseModal
        open={true}
        result={itemizedResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getAllByText("Bar do Zé").length).toBeGreaterThanOrEqual(1);
  });

  it("displays participants with handle and confidence", () => {
    render(
      <VoiceExpenseModal
        open={true}
        result={singleResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("João")).toBeInTheDocument();
    expect(screen.getByText("@joao123")).toBeInTheDocument();
  });

  it("shows warning when amount is zero for single_amount", () => {
    const zeroResult: VoiceExpenseResult = {
      ...singleResult,
      amountCents: 0,
    };
    render(
      <VoiceExpenseModal
        open={true}
        result={zeroResult}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Informe o valor antes de confirmar")).toBeInTheDocument();
  });

  it("calls onConfirm with result when confirm clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        open={true}
        result={singleResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].title).toBe("Uber");
    expect(onConfirm.mock.calls[0][0].amountCents).toBe(2500);
  });

  it("calls onCancel when cancel clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceExpenseModal
        open={true}
        result={singleResult}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Cancelar"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
