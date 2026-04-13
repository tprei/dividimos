import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    expect(screen.getByTestId("quick-charge-payer-self")).toHaveTextContent("Eu (@joao)");
    expect(screen.getByTestId("quick-charge-payer-other")).toHaveTextContent("Maria");
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

  describe("status states", () => {
    it("shows loading state when confirming", () => {
      renderSheet({ status: "confirming" });

      expect(screen.getByTestId("quick-charge-confirm")).toBeDisabled();
      expect(screen.getByTestId("quick-charge-edit")).toBeDisabled();
      expect(screen.getByTestId("quick-charge-confirm")).toHaveTextContent("Enviando…");
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
