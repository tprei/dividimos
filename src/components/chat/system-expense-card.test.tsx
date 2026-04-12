import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemExpenseCard } from "./system-expense-card";
import type { Expense, UserProfile } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href, "aria-label": ariaLabel }: { children: React.ReactNode; href: string; "aria-label"?: string }) => (
    <a href={href} aria-label={ariaLabel}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const creator: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: undefined,
};

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    groupId: "group-1",
    creatorId: "user-1",
    title: "Jantar no restaurante",
    expenseType: "single_amount",
    totalAmount: 15000,
    serviceFeePercent: 0,
    fixedFees: 0,
    status: "active",
    createdAt: "2026-04-10T20:00:00Z",
    updatedAt: "2026-04-10T20:00:00Z",
    ...overrides,
  };
}

describe("SystemExpenseCard", () => {
  it("renders expense title and formatted amount", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    expect(screen.getByText("Jantar no restaurante")).toBeInTheDocument();
    expect(screen.getByText("R$ 150,00")).toBeInTheDocument();
  });

  it("renders creator first name in header text", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    expect(screen.getByText("Alice adicionou uma conta")).toBeInTheDocument();
  });

  it("renders date in pt-BR format", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    expect(screen.getByText("10/04/2026")).toBeInTheDocument();
  });

  it("links to the expense detail page", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/app/bill/exp-1");
  });

  it("shows status badge for active expense", () => {
    render(<SystemExpenseCard expense={makeExpense({ status: "active" })} creator={creator} />);

    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it("shows status badge for settled expense", () => {
    render(<SystemExpenseCard expense={makeExpense({ status: "settled" })} creator={creator} />);

    expect(screen.getByText("Quitada")).toBeInTheDocument();
  });

  it("shows draft status with placeholder amount", () => {
    render(
      <SystemExpenseCard expense={makeExpense({ status: "draft" })} creator={creator} />,
    );

    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("Em criação...")).toBeInTheDocument();
  });

  it("renders merchant name when present", () => {
    render(
      <SystemExpenseCard
        expense={makeExpense({ merchantName: "Outback Steakhouse" })}
        creator={creator}
      />,
    );

    expect(screen.getByText("Outback Steakhouse")).toBeInTheDocument();
  });

  it("does not render merchant name when absent", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    expect(screen.queryByText("Outback Steakhouse")).not.toBeInTheDocument();
  });

  it("renders creator avatar", () => {
    render(<SystemExpenseCard expense={makeExpense()} creator={creator} />);

    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("shows Editar link for draft expenses", () => {
    render(
      <SystemExpenseCard expense={makeExpense({ status: "draft" })} creator={creator} />,
    );

    const editLink = screen.getByRole("link", { name: "Editar rascunho" });
    expect(editLink).toBeInTheDocument();
  });

  it("Editar link points to wizard with groupId, title, and amount params", () => {
    render(
      <SystemExpenseCard
        expense={makeExpense({ status: "draft", groupId: "group-1", title: "Jantar no restaurante", totalAmount: 15000 })}
        creator={creator}
      />,
    );

    const editLink = screen.getByRole("link", { name: "Editar rascunho" });
    expect(editLink).toHaveAttribute(
      "href",
      "/app/bill/new?groupId=group-1&title=Jantar%20no%20restaurante&amount=15000",
    );
  });

  it("does not show Editar link for active expenses", () => {
    render(
      <SystemExpenseCard expense={makeExpense({ status: "active" })} creator={creator} />,
    );

    expect(screen.queryByRole("link", { name: "Editar rascunho" })).not.toBeInTheDocument();
  });

  it("does not show Editar link for settled expenses", () => {
    render(
      <SystemExpenseCard expense={makeExpense({ status: "settled" })} creator={creator} />,
    );

    expect(screen.queryByRole("link", { name: "Editar rascunho" })).not.toBeInTheDocument();
  });
});
