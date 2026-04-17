import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickSplitSheet } from "./quick-split-sheet";
import type { UserProfile } from "@/types";

const CURRENT_USER = "user-1";
const COUNTERPARTY: UserProfile = {
  id: "user-2",
  handle: "maria",
  name: "Maria Silva",
};

function renderSheet(overrides: Partial<Parameters<typeof QuickSplitSheet>[0]> = {}) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const result = render(
    <QuickSplitSheet
      open
      onClose={onClose}
      currentUserId={CURRENT_USER}
      counterparty={COUNTERPARTY}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { user, onClose, onConfirm, ...result };
}

function setInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function setCurrencyInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function fillForm(title: string, amount: string) {
  setInput("quick-split-title", title);
  setCurrencyInput("quick-split-amount", amount);
}

describe("QuickSplitSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <QuickSplitSheet
        open={false}
        onClose={vi.fn()}
        currentUserId={CURRENT_USER}
        counterparty={COUNTERPARTY}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("quick-split-sheet")).not.toBeInTheDocument();
  });

  it("renders the sheet when open", () => {
    renderSheet();
    expect(screen.getByTestId("quick-split-sheet")).toBeInTheDocument();
    expect(screen.getByText("Dividir conta")).toBeInTheDocument();
  });

  it("starts with equal split method selected", () => {
    renderSheet();
    const equalBtn = screen.getByTestId("split-method-equal");
    expect(equalBtn).toHaveClass("bg-card");
  });

  it("confirm button is disabled when title and amount are empty", () => {
    renderSheet();
    expect(screen.getByTestId("quick-split-confirm")).toBeDisabled();
  });

  it("shows equal split preview when amount is entered", () => {
    renderSheet();
    fillForm("Pizza", "50,00");

    expect(screen.getByTestId("quick-split-preview")).toBeInTheDocument();
    // Both participants show R$ 25,00 in equal split
    expect(screen.getAllByText("R$ 25,00")).toHaveLength(2);
  });

  it("enables confirm when title and amount are filled (equal split)", () => {
    renderSheet();
    fillForm("Pizza", "100,00");

    expect(screen.getByTestId("quick-split-confirm")).not.toBeDisabled();
  });

  it("calls onConfirm with equal split shares", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("Pizza", "100,00");
    await user.click(screen.getByTestId("quick-split-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0];
    expect(result.title).toBe("Pizza");
    expect(result.amountCents).toBe(10000);
    expect(result.splitType).toBe("equal");
    expect(result.shares).toHaveLength(2);
    expect(result.shares[0].shareAmountCents + result.shares[1].shareAmountCents).toBe(10000);
    expect(result.payerId).toBe(CURRENT_USER);
  });

  it("handles odd amount equal split with remainder", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("Café", "10,01");
    await user.click(screen.getByTestId("quick-split-confirm"));

    const result = onConfirm.mock.calls[0][0];
    expect(result.shares[0].shareAmountCents + result.shares[1].shareAmountCents).toBe(1001);
  });

  it("switches to percentage split and shows input", async () => {
    const { user } = renderSheet();
    fillForm("Almoço", "80,00");
    await user.click(screen.getByTestId("split-method-percentage"));

    expect(screen.getByTestId("quick-split-my-percentage")).toBeInTheDocument();
  });

  it("calls onConfirm with percentage split shares", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("Almoço", "100,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "70");
    await user.click(screen.getByTestId("quick-split-confirm"));

    const result = onConfirm.mock.calls[0][0];
    expect(result.splitType).toBe("percentage");
    expect(result.shares[0]).toEqual({ userId: CURRENT_USER, shareAmountCents: 7000 });
    expect(result.shares[1]).toEqual({ userId: COUNTERPARTY.id, shareAmountCents: 3000 });
  });

  it("switches to fixed split and shows input", async () => {
    const { user } = renderSheet();
    fillForm("Uber", "30,00");
    await user.click(screen.getByTestId("split-method-fixed"));

    expect(screen.getByTestId("quick-split-my-fixed")).toBeInTheDocument();
  });

  it("calls onConfirm with fixed split shares", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("Uber", "30,00");
    await user.click(screen.getByTestId("split-method-fixed"));
    setCurrencyInput("quick-split-my-fixed", "20,00");
    await user.click(screen.getByTestId("quick-split-confirm"));

    const result = onConfirm.mock.calls[0][0];
    expect(result.splitType).toBe("fixed");
    expect(result.shares[0]).toEqual({ userId: CURRENT_USER, shareAmountCents: 2000 });
    expect(result.shares[1]).toEqual({ userId: COUNTERPARTY.id, shareAmountCents: 1000 });
  });

  it("calls onClose when close button is clicked", async () => {
    const { user, onClose } = renderSheet();
    await user.click(screen.getByTestId("quick-split-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error message when status is error", () => {
    renderSheet({ status: "error", errorMessage: "Algo deu errado" });
    expect(screen.getByTestId("quick-split-error")).toHaveTextContent("Algo deu errado");
  });

  it("disables inputs during confirming state", () => {
    renderSheet({ status: "confirming" });
    expect(screen.getByTestId("quick-split-title")).toBeDisabled();
    expect(screen.getByTestId("quick-split-amount")).toBeDisabled();
    expect(screen.getByTestId("quick-split-confirm")).toBeDisabled();
  });

  it("shows confirmed state text", () => {
    renderSheet({ status: "confirmed" });
    expect(screen.getByTestId("quick-split-confirm")).toHaveTextContent("Dividido!");
  });

  it("prevents closing during confirming state", async () => {
    const { user, onClose } = renderSheet({ status: "confirming" });
    await user.click(screen.getByTestId("quick-split-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows warning for invalid percentage", async () => {
    const { user } = renderSheet();
    fillForm("X", "50,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "110");

    expect(screen.getByText("Porcentagem deve estar entre 0% e 100%")).toBeInTheDocument();
  });

  it("shows warning when fixed amount exceeds total", async () => {
    const { user } = renderSheet();
    fillForm("X", "30,00");
    await user.click(screen.getByTestId("split-method-fixed"));
    setCurrencyInput("quick-split-my-fixed", "40,00");

    expect(screen.getByText("Valor excede o total")).toBeInTheDocument();
  });
});
