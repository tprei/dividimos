import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  runBackHandlers,
  __resetBackHandlerStackForTests,
} from "@/lib/capacitor/back-handler";
import {
  GroupRegisterPaymentSheet,
  type GroupPaymentStatus,
} from "./group-register-payment-sheet";

const MEMBERS = [
  { id: "user-bob", name: "Bob Santos", handle: "bob", owedByMeCents: 5000, owedToMeCents: 2500 },
  { id: "user-carol", name: "Carol Dias", handle: "carol", owedByMeCents: 10000, owedToMeCents: 7500 },
];

function renderSheet(
  status?: GroupPaymentStatus,
  counterparties = MEMBERS,
  onDismiss = vi.fn(),
  onLeavePending = vi.fn(),
) {
  const onConfirm = vi.fn();
  // A real mounted trigger: the popover positions against it and focus
  // returns there on dismissal, exactly as in the chat screen.
  const anchor = document.createElement("button");
  anchor.textContent = "Registrar pagamento";
  document.body.appendChild(anchor);
  render(
    <GroupRegisterPaymentSheet
      currentUserHandle="alice"
      counterparties={counterparties}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      onLeavePending={onLeavePending}
      status={status}
      anchor={anchor}
    />,
  );
  return { onConfirm, onDismiss, onLeavePending, user: userEvent.setup() };
}

function setAmountText(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Valor do pagamento" }), {
    target: { value },
  });
}

describe("GroupRegisterPaymentSheet", () => {
  beforeEach(() => {
    __resetBackHandlerStackForTests();
  });

  it("dismissing over a background control does not activate that control", async () => {
    const undo = vi.fn();
    const undoButton = document.createElement("button");
    undoButton.textContent = "Desfazer";
    undoButton.addEventListener("click", undo);
    document.body.appendChild(undoButton);

    const { onDismiss, user } = renderSheet();

    // The tap that closes the form lands on the backdrop, never on the
    // settlement control underneath it.
    const backdrop = document.querySelector('[data-slot="popover-backdrop"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);

    expect(onDismiss).toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it("does not call onDismiss when X button is clicked while confirming", () => {
    const onDismiss = vi.fn();
    renderSheet("confirming", undefined, onDismiss);

    const closeBtn = screen.getByTestId("group-payment-dismiss");
    expect(closeBtn).toBeDisabled();
    fireEvent.click(closeBtn);

    expect(onDismiss).not.toHaveBeenCalled();
  });


  it("consumes back navigation without dismissing during confirming status", () => {
    const onDismiss = vi.fn();
    renderSheet("confirming", undefined, onDismiss);

    runBackHandlers();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("sets aria-busy on the sheet wrapper while confirming", () => {
    renderSheet("confirming");
    expect(screen.getByTestId("group-payment-sheet")).toHaveAttribute("aria-busy", "true");
  });

  it("shows pending state after 15s and its exit honours onLeavePending, not onDismiss", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const onLeavePending = vi.fn();
      renderSheet("confirming", undefined, onDismiss, onLeavePending);

      expect(screen.queryByTestId("group-payment-pending")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(15000);
      });

      expect(screen.getByTestId("group-payment-pending")).toBeInTheDocument();
      expect(screen.getByText("Pendente")).toBeInTheDocument();
      expect(screen.getByText("Ainda aguardando confirmação")).toBeInTheDocument();
      expect(
        screen.getByText(/Se o pagamento tiver sido registrado/),
      ).toBeInTheDocument();

      const exitBtn = screen.getByRole("button", { name: "Sair por enquanto" });
      fireEvent.click(exitBtn);
      expect(onLeavePending).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports the chosen member, direction, and amount in cents", async () => {
    const { onConfirm, user } = renderSheet();

    await user.click(screen.getByRole("combobox", { name: "Com quem?" }));
    await user.click(await screen.findByRole("option", { name: /Carol Dias/ }));
    setAmountText("3,00");
    await user.click(screen.getByTestId("group-payment-confirm"));

    expect(onConfirm).toHaveBeenCalledWith({
      counterpartyId: "user-carol",
      payerIsSelf: true,
      amountCents: 300,
      allowOverpay: false,
    });
  });

  it("reverses the direction when the other member paid", async () => {
    const { onConfirm, user } = renderSheet();

    setAmountText("0,50");
    await user.click(screen.getByTestId("group-payment-payer-other"));
    await user.click(screen.getByTestId("group-payment-confirm"));

    expect(onConfirm).toHaveBeenCalledWith({
      counterpartyId: "user-bob",
      payerIsSelf: false,
      amountCents: 50,
      allowOverpay: false,
    });
  });

  it("cannot confirm without an amount", async () => {
    const { onConfirm, user } = renderSheet();

    await user.click(screen.getByTestId("group-payment-confirm"));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores a second confirm while the first is in flight", async () => {
    const { onConfirm, user } = renderSheet("confirming");

    await user.click(screen.getByTestId("group-payment-confirm"));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("caps the amount at the pairwise debt and disables confirm for an over-cap value", () => {
    renderSheet();
    const input = screen.getByTestId("group-payment-amount") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "60,00" } });

    expect(input).toHaveAttribute("aria-invalid");
    expect(screen.getByTestId("group-payment-confirm")).toBeDisabled();
  });

  it("sets the amount to exactly the debt via Quitar tudo", async () => {
    const { onConfirm, user } = renderSheet();

    await user.click(screen.getByTestId("group-payment-settle-all"));
    await user.click(screen.getByTestId("group-payment-confirm"));

    expect(onConfirm).toHaveBeenCalledWith({
      counterpartyId: "user-bob",
      payerIsSelf: true,
      amountCents: 5000,
      allowOverpay: false,
    });
  });

  it("shows settled copy and hides chip row when both debt figures are zero", () => {
    const zeroMember = [
      { id: "user-dave", name: "Dave Souza", handle: "dave", owedByMeCents: 0, owedToMeCents: 0 },
    ];
    renderSheet(undefined, zeroMember);

    expect(screen.getByTestId("group-payment-settled")).toHaveTextContent(
      "Vocês estão quitados nesse grupo.",
    );
    expect(screen.queryByRole("button", { name: "Adicionar R$1" })).not.toBeInTheDocument();
  });

  it("allows an above-cap amount after clicking the override and reports allowOverpay true", () => {
    const { onConfirm } = renderSheet();
    const input = screen.getByTestId("group-payment-amount") as HTMLInputElement;

    fireEvent.click(screen.getByTestId("group-payment-allow-overpay"));
    expect(screen.getByTestId("group-payment-overpay-note")).toHaveTextContent(
      "Sem limite: o que passar da dívida vira crédito. Limitar à dívida",
    );

    fireEvent.change(input, { target: { value: "60,00" } });
    expect(input).not.toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByTestId("group-payment-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      counterpartyId: "user-bob",
      payerIsSelf: true,
      amountCents: 6000,
      allowOverpay: true,
    });

    fireEvent.click(screen.getByTestId("group-payment-limit-to-debt"));
    expect(input.value).toBe("50,00");
  });

  it("clamps the amount down when flipping payer direction reduces the cap", async () => {
    const { onConfirm, user } = renderSheet();

    setAmountText("40,00");
    await user.click(screen.getByTestId("group-payment-payer-other"));

    const input = screen.getByTestId("group-payment-amount") as HTMLInputElement;
    expect(input.value).toBe("25,00");

    await user.click(screen.getByTestId("group-payment-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      counterpartyId: "user-bob",
      payerIsSelf: false,
      amountCents: 2500,
      allowOverpay: false,
    });
  });
});
