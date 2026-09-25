import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { runBackHandlers } from "@/lib/capacitor/back-handler";
import { QuickSplitSheet } from "./quick-split-sheet";
import type { UserProfile } from "@/types/ledger";

const CURRENT_USER = "user-1";
const COUNTERPARTY: UserProfile = {
  id: "user-2",
  handle: "maria",
  name: "Maria Silva",
  avatarUrl: null,
  isBot: false,
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
    expect(screen.getByRole("heading", { name: "Dividir conta" })).toBeInTheDocument();
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

    const preview = screen.getByTestId("quick-split-preview");
    // Both participants show R$ 25,00 in equal split
    expect(within(preview).getAllByText("R$ 25,00")).toHaveLength(2);
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

  it("switches to fixed split and shows input with accessible name", async () => {
    const { user } = renderSheet();
    fillForm("Uber", "30,00");
    await user.click(screen.getByTestId("split-method-fixed"));

    expect(screen.getByTestId("quick-split-my-fixed")).toBeInTheDocument();
    expect(screen.getByLabelText("Seu valor fixo")).toBeInTheDocument();
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

  it("closes on hardware Back instead of navigating away", () => {
    const { onClose } = renderSheet();

    // true means the app consumed Back; false would let it navigate.
    expect(runBackHandlers()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open on hardware Back while a confirm is in flight", () => {
    const { onClose } = renderSheet({ status: "confirming" });

    expect(runBackHandlers()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows warning for invalid percentage", async () => {
    const { user } = renderSheet();
    fillForm("X", "50,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "110");

    expect(screen.getByText("Use de 0% a 100%")).toBeInTheDocument();
  });

  it("shows warning when fixed amount exceeds total", async () => {
    const { user } = renderSheet();
    fillForm("X", "30,00");
    await user.click(screen.getByTestId("split-method-fixed"));
    setCurrencyInput("quick-split-my-fixed", "40,00");

    expect(screen.getByText("Valor excede o total")).toBeInTheDocument();
  });
 
  it("accepts decimal percentage 12,5 and allocates exact cent shares", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("X", "90,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "12,5");

    const preview = screen.getByTestId("quick-split-preview");
    expect(within(preview).getByText("87,50")).toBeInTheDocument();
    expect(within(preview).getByText("R$ 11,25")).toBeInTheDocument();
    expect(within(preview).getByText("R$ 78,75")).toBeInTheDocument();
    expect(screen.getByTestId("quick-split-confirm")).toBeEnabled();

    await user.click(screen.getByTestId("quick-split-confirm"));
    const result = onConfirm.mock.calls[0][0];
    expect(result.shares).toEqual([
      { userId: "user-1", shareAmountCents: 1125 },
      { userId: "user-2", shareAmountCents: 7875 },
    ]);
  });

  it("entering 150 retains 150 as typed, shows range warning, and disables confirm", async () => {
    const { user } = renderSheet();
    fillForm("X", "50,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "150");

    expect(screen.getByTestId("quick-split-my-percentage")).toHaveValue("150");
    expect(screen.getByTestId("quick-split-my-percentage")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use de 0% a 100%")).toBeInTheDocument();
    expect(screen.getByTestId("quick-split-confirm")).toBeDisabled();
  });

  it("reports excess precision as a format problem instead of an out-of-range one", async () => {
    const { user } = renderSheet();
    fillForm("X", "50,00");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "33,335");

    expect(screen.getByText("Use de 0% a 100%, com até duas casas")).toBeInTheDocument();
    expect(screen.queryByText("Use de 0% a 100%")).not.toBeInTheDocument();
  });

  it("splits whole percentages with an exact-sum result", async () => {
    const { user, onConfirm } = renderSheet();
    fillForm("X", "10,01");
    await user.click(screen.getByTestId("split-method-percentage"));
    setInput("quick-split-my-percentage", "33");
    expect(screen.getByText("67")).toBeInTheDocument();
    expect(screen.queryByText("67,00")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("quick-split-confirm"));

    const result = onConfirm.mock.calls[0][0];
    expect(result.splitType).toBe("percentage");
    expect(result.shares[0].shareAmountCents + result.shares[1].shareAmountCents).toBe(1001);
  });

  it("flags malformed total amount and blocks confirmation", () => {
    renderSheet();
    fillForm("Pizza", "1.23.456");

    expect(screen.getAllByText("Valor inválido. Escreva assim: 10,50").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("quick-split-confirm")).toBeDisabled();
  });

  it("reports the current user as the payer and still confirms them as payer", async () => {
    const { user, onConfirm } = renderSheet();
    expect(screen.getByTestId("quick-split-payer-self")).toBeChecked();

    fillForm("Pizza", "50,00");
    await user.click(screen.getByTestId("quick-split-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].payerId).toBe(CURRENT_USER);
  });

  it("allows selecting counterparty as payer and reports counterparty payerId on confirm", async () => {
    const { user, onConfirm } = renderSheet();
    await user.click(screen.getByTestId("quick-split-payer-other"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();
    expect(screen.getByTestId("quick-split-payer-self")).not.toBeChecked();

    fillForm("Pizza", "60,00");
    await user.click(screen.getByTestId("quick-split-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].payerId).toBe(COUNTERPARTY.id);
  });

  it("inverts the debt direction summary when payer is switched", async () => {
    const { user } = renderSheet();
    fillForm("Pizza", "100,00");

    const summary = screen.getByTestId("quick-split-debt-summary");
    expect(summary).toHaveTextContent("Maria Silva deve R$ 50,00 para você");

    await user.click(screen.getByTestId("quick-split-payer-other"));
    expect(summary).toHaveTextContent("Você deve R$ 50,00 para Maria Silva");

    await user.click(screen.getByTestId("quick-split-payer-self"));
    expect(summary).toHaveTextContent("Maria Silva deve R$ 50,00 para você");
  });

  it("preserves selected payer when switching between equal and percentage methods", async () => {
    const { user } = renderSheet();
    fillForm("Pizza", "100,00");
    await user.click(screen.getByTestId("quick-split-payer-other"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();

    await user.click(screen.getByTestId("split-method-percentage"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();

    await user.click(screen.getByTestId("split-method-fixed"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();

    await user.click(screen.getByTestId("split-method-equal"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();
  });

  it("preserves selected payer across error state and keeps confirm enabled for retry", async () => {
    const { user, rerender } = renderSheet();
    fillForm("Pizza", "100,00");
    await user.click(screen.getByTestId("quick-split-payer-other"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();

    rerender(
      <QuickSplitSheet
        open
        onClose={vi.fn()}
        currentUserId={CURRENT_USER}
        counterparty={COUNTERPARTY}
        onConfirm={vi.fn()}
        status="error"
        errorMessage="Falha ao salvar divisão"
      />,
    );

    expect(screen.getByTestId("quick-split-error")).toHaveTextContent("Falha ao salvar divisão");
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();
    expect(screen.getByTestId("quick-split-confirm")).toBeEnabled();
  });

  it("resets the payer to the viewer when the sheet reopens", async () => {
    const { user, rerender } = renderSheet();
    fillForm("Pizza", "100,00");
    await user.click(screen.getByTestId("quick-split-payer-other"));
    expect(screen.getByTestId("quick-split-payer-other")).toBeChecked();

    rerender(
      <QuickSplitSheet
        open={false}
        onClose={vi.fn()}
        currentUserId={CURRENT_USER}
        counterparty={COUNTERPARTY}
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <QuickSplitSheet
        open
        onClose={vi.fn()}
        currentUserId={CURRENT_USER}
        counterparty={COUNTERPARTY}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId("quick-split-payer-self")).toBeChecked();
    expect(screen.getByTestId("quick-split-payer-other")).not.toBeChecked();
  });

  it("renders handles when provided", () => {
    renderSheet({ currentUserHandle: "usuario" });
    expect(screen.getByText("@usuario")).toBeInTheDocument();
    expect(screen.getByText("@maria")).toBeInTheDocument();
  });
});
