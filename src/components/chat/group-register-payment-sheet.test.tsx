import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { GroupRegisterPaymentSheet } from "./group-register-payment-sheet";

const MEMBERS = [
  { id: "user-bob", name: "Bob Santos", handle: "bob" },
  { id: "user-carol", name: "Carol Dias", handle: "carol" },
];

function renderSheet(status?: "confirming") {
  const onConfirm = vi.fn();
  render(
    <GroupRegisterPaymentSheet
      currentUserHandle="alice"
      counterparties={MEMBERS}
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
});
