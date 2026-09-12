import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { GroupRegisterPaymentSheet } from "./group-register-payment-sheet";

const MEMBERS = [
  { id: "user-bob", name: "Bob Santos", handle: "bob", owedByMeCents: 5000, owedToMeCents: 2500 },
  { id: "user-carol", name: "Carol Dias", handle: "carol", owedByMeCents: 10000, owedToMeCents: 7500 },
];

function renderSheet(
  status?: "confirming",
  counterparties = MEMBERS,
) {
  const onConfirm = vi.fn();
  render(
    <GroupRegisterPaymentSheet
      currentUserHandle="alice"
      counterparties={counterparties}
      onConfirm={onConfirm}
      onDismiss={vi.fn()}
      status={status}
    />,
  );
  return { onConfirm, user: userEvent.setup() };
}

async function typeAmount(user: UserEvent, digits: string) {
  await user.click(screen.getByRole("textbox", { name: "Valor do pagamento" }));
  await user.keyboard(digits);
}

describe("GroupRegisterPaymentSheet", () => {
  it("reports the chosen member, direction, and amount in cents", async () => {
    const { onConfirm, user } = renderSheet();

    await user.click(screen.getByTestId("group-payment-member-user-carol"));
    await typeAmount(user, "300");
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

    await typeAmount(user, "50");
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
    expect(screen.getByText("Sem limite de dívida.")).toBeInTheDocument();

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

    await typeAmount(user, "4000");
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
