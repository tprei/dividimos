import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebtCard } from "./debt-card";
import type { DebtSummary } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockDebt: DebtSummary = {
  groupId: "g1",
  groupName: "Almoço",
  counterpartyId: "u2",
  counterpartyName: "Maria Silva",
  counterpartyAvatarUrl: null,
  amountCents: 5000,
  direction: "owes",
  isDm: false,
};

describe("DebtCard", () => {
  it("renders a link to the conversation page", () => {
    render(
      <DebtCard
        debt={mockDebt}
        onPay={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/app/conversations/u2");
  });

  it("displays counterparty name and group name", () => {
    render(
      <DebtCard
        debt={mockDebt}
        onPay={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
  });

  it("shows 'Pagar via Pix' button when user owes", () => {
    render(
      <DebtCard
        debt={mockDebt}
        onPay={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    expect(screen.getByText("Pagar via Pix")).toBeInTheDocument();
  });

  it("shows 'Cobrar via Pix' button when user is owed", () => {
    const owedDebt: DebtSummary = { ...mockDebt, direction: "owed" };
    render(
      <DebtCard
        debt={owedDebt}
        onPay={vi.fn()}
        onCollect={vi.fn()}
      />,
    );

    expect(screen.getByText("Cobrar via Pix")).toBeInTheDocument();
  });
});
