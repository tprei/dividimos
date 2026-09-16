import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  runBackHandlers,
  __resetBackHandlerStackForTests,
} from "@/lib/capacitor/back-handler";
import { QuickChargeSheet } from "./quick-charge-sheet";

const defaultProps = {
  counterpartyName: "Maria",
  counterpartyHandle: "maria123",
  currentUserHandle: "joao",
  onConfirm: vi.fn(),
  onEdit: vi.fn(),
  onDismiss: vi.fn(),
};

function renderSheet(overrides = {}) {
  return render(<QuickChargeSheet {...defaultProps} {...overrides} />);
}

describe("QuickChargeSheet", () => {
  it("renders the charge sheet with header and inputs", () => {
    renderSheet();

    expect(screen.getByTestId("quick-charge-sheet")).toBeInTheDocument();
    expect(screen.getByText("Cobrança rápida")).toBeInTheDocument();
    expect(screen.getByText("Cobrar de Maria")).toBeInTheDocument();
    expect(screen.getByTestId("quick-charge-amount")).toBeInTheDocument();
    expect(screen.getByTestId("quick-charge-description")).toBeInTheDocument();
  });

  it("renders payer toggle with both options", () => {
    renderSheet();

    expect(screen.getByTestId("quick-charge-payer-self")).toHaveTextContent("Eu");
    expect(screen.getByTestId("quick-charge-payer-self")).toHaveTextContent("@joao");
    expect(screen.getByTestId("quick-charge-payer-other")).toHaveTextContent("Maria");
    expect(screen.getByTestId("quick-charge-payer-other")).toHaveTextContent("@maria123");
  });

  it("defaults payer to self", () => {
    renderSheet();

    const selfBtn = screen.getByTestId("quick-charge-payer-self");
    expect(selfBtn.className).toContain("border-primary");
  });

  it("toggles payer when clicking counterparty", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByTestId("quick-charge-payer-other"));

    const otherBtn = screen.getByTestId("quick-charge-payer-other");
    expect(otherBtn.className).toContain("border-primary");
    expect(otherBtn.className).toContain("bg-primary/10");
  });

  it("disables confirm button when amount is zero", () => {
    renderSheet();

    expect(screen.getByTestId("quick-charge-confirm")).toBeDisabled();
  });

  it("enables confirm after entering an amount via quick add", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByLabelText("Adicionar R$10"));

    expect(screen.getByTestId("quick-charge-confirm")).toBeEnabled();
  });

  it("calls onConfirm with ChatExpenseResult when confirmed", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    await user.click(screen.getByLabelText("Adicionar R$50"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    expect(onConfirm).toHaveBeenCalledOnce();
    const result = onConfirm.mock.calls[0][0];
    expect(result.amountCents).toBe(5000);
    expect(result.expenseType).toBe("single_amount");
    expect(result.splitType).toBe("equal");
    expect(result.payerHandle).toBe("SELF");
    expect(result.confidence).toBe("high");
    expect(result.participants).toEqual([
      { spokenName: "maria123", matchedHandle: "maria123", confidence: "high" },
    ]);
  });

  it("sets payerHandle to counterparty when payer toggled", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    await user.click(screen.getByLabelText("Adicionar R$10"));
    await user.click(screen.getByTestId("quick-charge-payer-other"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    expect(onConfirm.mock.calls[0][0].payerHandle).toBe("maria123");
  });

  it("shows 'Devo a' header and 'Registrar' confirm text when counterparty paid", async () => {
    const user = userEvent.setup();
    renderSheet();

    expect(screen.getByText("Cobrar de Maria")).toBeInTheDocument();
    expect(screen.getByTestId("quick-charge-confirm")).toHaveTextContent("Cobrar");

    await user.click(screen.getByTestId("quick-charge-payer-other"));

    expect(screen.queryByText("Cobrar de Maria")).not.toBeInTheDocument();
    expect(screen.getByText("Devo a Maria")).toBeInTheDocument();
    expect(screen.getByTestId("quick-charge-confirm")).toHaveTextContent("Registrar");
  });

  it("generates an owed-direction description when counterparty paid", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    await user.click(screen.getByTestId("quick-charge-payer-other"));
    await user.click(screen.getByLabelText("Adicionar R$10"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    const title: string = onConfirm.mock.calls[0][0].title;
    expect(title).toContain("Cobrança");
    expect(title).toContain("Maria");
    // "de Maria" (charged FROM Maria — I owe her), never "para Maria"
    // (charged TO Maria — she owes me), for this direction.
    expect(title).toContain("de Maria");
    expect(title).not.toContain("para Maria");
  });

  it("calls onEdit when edit button clicked", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onEdit });

    await user.click(screen.getByLabelText("Adicionar R$5"));
    await user.click(screen.getByTestId("quick-charge-edit"));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit.mock.calls[0][0].amountCents).toBe(500);
  });

  it("calls onDismiss when X button clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onDismiss });

    await user.click(screen.getByTestId("quick-charge-dismiss"));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses auto-generated description by default", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    await user.click(screen.getByLabelText("Adicionar R$10"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    expect(onConfirm.mock.calls[0][0].title).toContain("Cobrança");
    expect(onConfirm.mock.calls[0][0].title).toContain("Maria");
  });

  it("uses custom description when edited", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    const descInput = screen.getByTestId("quick-charge-description");
    fireEvent.change(descInput, { target: { value: "Pizza" } });
    await user.click(screen.getByLabelText("Adicionar R$10"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    expect(onConfirm.mock.calls[0][0].title).toBe("Pizza");
  });

  beforeEach(() => {
    __resetBackHandlerStackForTests();
  });

  describe("status states", () => {
    it("shows loading state when confirming", () => {
      renderSheet({ status: "confirming" });

      expect(screen.getByTestId("quick-charge-confirm")).toBeDisabled();
      expect(screen.getByTestId("quick-charge-edit")).toBeDisabled();
      expect(screen.getByTestId("quick-charge-confirm")).toHaveTextContent("Enviando…");
      expect(screen.getByTestId("quick-charge-sheet")).toHaveAttribute("aria-busy", "true");
    });

    it("does not call onDismiss when X button is clicked while confirming", () => {
      const onDismiss = vi.fn();
      renderSheet({ status: "confirming", onDismiss });

      const closeBtn = screen.getByTestId("quick-charge-dismiss");
      expect(closeBtn).toBeDisabled();
      expect(closeBtn.className).toContain("disabled:cursor-not-allowed");
      expect(closeBtn.className).toContain("disabled:opacity-40");
      fireEvent.click(closeBtn);

      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("consumes back navigation without dismissing during confirming status", () => {
      const onDismiss = vi.fn();
      renderSheet({ status: "confirming", onDismiss });

      const consumed = runBackHandlers();
      expect(consumed).toBe(true);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("renders Cobrado! and success styling when status is confirmed and payer is self", () => {
      renderSheet({ status: "confirmed" });

      const confirmBtn = screen.getByTestId("quick-charge-confirm");
      expect(confirmBtn).toBeDisabled();
      expect(confirmBtn).toHaveTextContent("Cobrado!");
      expect(confirmBtn.className).toContain("bg-success");
    });

    it("renders Registrado! and success styling when status is confirmed and payer is other", async () => {
      const user = userEvent.setup();
      const { rerender } = renderSheet({ status: "idle" });
      await user.click(screen.getByTestId("quick-charge-payer-other"));
      rerender(<QuickChargeSheet {...defaultProps} status="confirmed" />);

      const confirmBtn = screen.getByTestId("quick-charge-confirm");
      expect(confirmBtn).toBeDisabled();
      expect(confirmBtn).toHaveTextContent("Registrado!");
      expect(confirmBtn.className).toContain("bg-success");
    });

    it("shows pending state after 15s when confirming and allows exit via Sair por enquanto", () => {
      vi.useFakeTimers();
      try {
        const onDismiss = vi.fn();
        renderSheet({ status: "confirming", onDismiss });

        expect(screen.queryByTestId("quick-charge-pending")).not.toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(15000);
        });

        expect(screen.getByTestId("quick-charge-pending")).toBeInTheDocument();
        expect(screen.getByText("OPERAÇÃO PENDENTE")).toBeInTheDocument();
        expect(screen.getByText("Ainda aguardando confirmação")).toBeInTheDocument();
        expect(
          screen.getByText(/A conexão demorou mais que o esperado/),
        ).toBeInTheDocument();

        const exitBtn = screen.getByRole("button", { name: "Sair por enquanto" });
        fireEvent.click(exitBtn);
        expect(onDismiss).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("disables buttons when confirmed", () => {
      renderSheet({ status: "confirmed" });

      expect(screen.getByTestId("quick-charge-confirm")).toBeDisabled();
    });

    it("shows error message when status is error", () => {
      renderSheet({ status: "error", errorMessage: "Algo deu errado" });

      expect(screen.getByTestId("quick-charge-error")).toHaveTextContent("Algo deu errado");
    });

    it("does not show error without message", () => {
      renderSheet({ status: "error" });

      expect(screen.queryByTestId("quick-charge-error")).not.toBeInTheDocument();
    });
  });

  it("accumulates quick add amounts", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderSheet({ onConfirm });

    await user.click(screen.getByLabelText("Adicionar R$10"));
    await user.click(screen.getByLabelText("Adicionar R$5"));
    await user.click(screen.getByTestId("quick-charge-confirm"));

    expect(onConfirm.mock.calls[0][0].amountCents).toBe(1500);
  });
});
