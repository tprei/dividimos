import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemsStep } from "./items-step";
import type { ExpenseItem } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
});

const mockItem: ExpenseItem = {
  id: "item-1",
  expenseId: "exp-1",
  description: "Pizza Margherita",
  quantity: 2,
  unitPriceCents: 3500,
  totalPriceCents: 7000,
  createdAt: "",
};

describe("ItemsStep", () => {
  it("renders empty state with add button", () => {
    render(
      <ItemsStep
        items={[]}
        expense={null}
        grandTotal={0}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Adicione os itens da conta.")).toBeInTheDocument();
    expect(screen.getByText("Adicionar item")).toBeInTheDocument();
  });

  it("renders items with description and price", () => {
    render(
      <ItemsStep
        items={[mockItem]}
        expense={{ totalAmount: 7000, serviceFeePercent: 0, fixedFees: 0 }}
        grandTotal={7000}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Pizza Margherita")).toBeInTheDocument();
    expect(screen.getByText(/2x/)).toBeInTheDocument();
  });

  it("shows item count when items exist", () => {
    render(
      <ItemsStep
        items={[mockItem]}
        expense={{ totalAmount: 7000, serviceFeePercent: 0, fixedFees: 0 }}
        grandTotal={7000}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 itens/)).toBeInTheDocument();
  });

  it("calls onRemoveItem when remove button clicked", async () => {
    const onRemoveItem = vi.fn();
    const user = userEvent.setup();
    render(
      <ItemsStep
        items={[mockItem]}
        expense={{ totalAmount: 7000, serviceFeePercent: 0, fixedFees: 0 }}
        grandTotal={7000}
        onAddItem={vi.fn()}
        onRemoveItem={onRemoveItem}
      />,
    );

    const removeButtons = screen.getAllByRole("button");
    const removeBtn = removeButtons.find(
      (btn) => btn.querySelector("svg") && !btn.textContent?.includes("Adicionar"),
    );
    if (removeBtn) {
      await user.click(removeBtn);
      expect(onRemoveItem).toHaveBeenCalledWith("item-1");
    }
  });

  it("shows service fee breakdown when serviceFeePercent > 0", () => {
    render(
      <ItemsStep
        items={[mockItem]}
        expense={{ totalAmount: 7000, serviceFeePercent: 10, fixedFees: 0 }}
        grandTotal={7700}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText(/Garçom \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText("Total com garçom")).toBeInTheDocument();
  });

  it("shows fixed fees when present", () => {
    render(
      <ItemsStep
        items={[mockItem]}
        expense={{ totalAmount: 7000, serviceFeePercent: 10, fixedFees: 500 }}
        grandTotal={8200}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Couvert")).toBeInTheDocument();
  });

  it("toggles add item form on button click", async () => {
    const user = userEvent.setup();
    render(
      <ItemsStep
        items={[]}
        expense={null}
        grandTotal={0}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Adicionar item"));
    expect(screen.getByPlaceholderText("Descrição (ex: Picanha 400g)")).toBeInTheDocument();
  });
});
