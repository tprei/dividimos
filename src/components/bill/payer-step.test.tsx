import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PayerStep } from "./payer-step";
import type { UserProfile } from "@/types";

function profile(id: string, name: string): UserProfile {
  return { id, name, handle: name.toLowerCase(), avatarUrl: null };
}

const participants = [profile("a", "Ana"), profile("b", "Bruno"), profile("c", "Caio")];

function renderPercentMode(grandTotal: number) {
  const onSetPayerAmount = vi.fn();
  const onRemovePayerEntry = vi.fn();
  render(
    <PayerStep
      participants={participants}
      payers={[
        { userId: "a", amountCents: 1 },
        { userId: "b", amountCents: 1 },
      ]}
      grandTotal={grandTotal}
      onSetPayerFull={vi.fn()}
      onSplitPaymentEqually={vi.fn()}
      onSetPayerAmount={onSetPayerAmount}
      onRemovePayerEntry={onRemovePayerEntry}
    />,
  );
  return { onSetPayerAmount, onRemovePayerEntry };
}

async function setPercent(name: string, value: number) {
  const slider = screen.getByLabelText(`Percentual pago por ${name}`);
  fireEvent.change(slider, { target: { value: String(value) } });
}

describe("PayerStep percentage mode", () => {
  it("allocates exact centavos that sum to the bill total", async () => {
    const user = userEvent.setup();
    const { onSetPayerAmount } = renderPercentMode(10_000);
    await user.click(screen.getByRole("button", { name: "Porcentagem" }));

    await setPercent("Ana", 33);
    await setPercent("Bruno", 33);
    await setPercent("Caio", 34);

    const lastCall = new Map<string, number>();
    for (const [userId, cents] of onSetPayerAmount.mock.calls) {
      lastCall.set(userId as string, cents as number);
    }
    const amounts = [...lastCall.values()];
    expect(amounts.every((cents) => Number.isInteger(cents))).toBe(true);
    expect(amounts.reduce((sum, cents) => sum + cents, 0)).toBe(10_000);
  });

  it("reports the overshoot instead of a negative shortfall", async () => {
    const user = userEvent.setup();
    renderPercentMode(10_000);
    await user.click(screen.getByRole("button", { name: "Porcentagem" }));

    await setPercent("Ana", 60);
    await setPercent("Bruno", 60);

    expect(screen.getByText(/excede 100% em 20%/)).toBeInTheDocument();
  });

  it("names the shortfall while the percentages are under 100", async () => {
    const user = userEvent.setup();
    renderPercentMode(10_000);
    await user.click(screen.getByRole("button", { name: "Porcentagem" }));

    await setPercent("Ana", 40);

    expect(screen.getByText(/faltam 60% para completar 100%/)).toBeInTheDocument();
  });

  it("holds no payer amounts while the percentages do not reach 100", async () => {
    const user = userEvent.setup();
    const { onSetPayerAmount, onRemovePayerEntry } = renderPercentMode(10_000);
    await user.click(screen.getByRole("button", { name: "Porcentagem" }));

    await setPercent("Ana", 50);

    expect(onSetPayerAmount).not.toHaveBeenCalled();
    expect(onRemovePayerEntry).toHaveBeenCalledWith("a");
    expect(onRemovePayerEntry).toHaveBeenCalledWith("b");
    expect(onRemovePayerEntry).toHaveBeenCalledWith("c");
  });

  it("shows a dash instead of a float estimate before the split is exact", async () => {
    const user = userEvent.setup();
    renderPercentMode(10_000);
    await user.click(screen.getByRole("button", { name: "Porcentagem" }));

    await setPercent("Ana", 50);

    expect(screen.queryByText("R$\u00a050,00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(participants.length);
  });
});
