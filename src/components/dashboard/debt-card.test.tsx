import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DebtCard } from "./debt-card";
import type { DebtRow } from "@/lib/ledger/debt-rows";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const baseRow: DebtRow = {
  groupId: "g1",
  groupName: "Almoço",
  isDm: false,
  counterpartyKind: "user",
  counterpartyId: "u2",
  counterpartyName: "Maria Silva",
  counterpartyAvatarUrl: null,
  amountCents: 5000,
  direction: "owes",
};

describe("DebtCard", () => {
  it("renders a link to the conversation page with counterparty and amount", () => {
    render(<DebtCard debt={baseRow} onPay={vi.fn()} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/app/conversations/u2");
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("calls onPay with the row when the user owes and presses Pagar via Pix", () => {
    const onPay = vi.fn();
    render(<DebtCard debt={baseRow} onPay={onPay} />);

    fireEvent.click(screen.getByRole("button", { name: "Pagar via Pix" }));
    expect(onPay).toHaveBeenCalledWith(baseRow);
  });

  it("shows no pay action when the user is owed", () => {
    render(
      <DebtCard
        debt={{ ...baseRow, direction: "owed" }}
        onPay={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Você recebe")).toBeInTheDocument();
  });

  it("renders a guest counterparty with a chip, no conversation link, and no pay action", () => {
    render(
      <DebtCard
        debt={{ ...baseRow, counterpartyKind: "guest", counterpartyName: "Bruno Convidado" }}
        onPay={vi.fn()}
      />,
    );

    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
