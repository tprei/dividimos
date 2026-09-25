import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddItemForm } from "./add-item-form";
import { haptics } from "@/hooks/use-haptics";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddItemForm", () => {
  it("renders form fields", () => {
    render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByPlaceholderText(/Descrição/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Preço unitário" })).toBeInTheDocument();
  });

  it("adds the line total and stays ready for the next item", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onAdd={onAdd} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Descrição/), "Chopp");
    await user.click(screen.getByLabelText("Aumentar quantidade"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preço unitário" }), { target: { value: "12,50" } });
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(onAdd).toHaveBeenCalledWith({ description: "Chopp", quantity: 2000, unitPriceCents: 1250, totalPriceCents: 2500 });
    expect(screen.getByPlaceholderText(/Descrição/)).toHaveValue("");
    expect(screen.getByPlaceholderText(/Descrição/)).toHaveFocus();
  });

  it("moves from the description to the price on Enter instead of submitting", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onAdd={onAdd} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/Descrição/), "Chopp{Enter}");

    expect(screen.getByRole("textbox", { name: "Preço unitário" })).toHaveFocus();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("renders quantity with default value of 1", () => {
    render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("1x")).toBeInTheDocument();
  });

  it("submit button is disabled when fields are empty", () => {
    render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

    const submitBtn = screen.getByText("Adicionar").closest("button");
    expect(submitBtn).not.toBeNull();
    expect(submitBtn!.hasAttribute("disabled") || submitBtn!.hasAttribute("data-disabled")).toBe(true);
  });

  it("calls onCancel when the composer is closed", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onAdd={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Fechar inclusão de item" }));

    expect(onCancel).toHaveBeenCalled();
  });

  it("does not submit when fields are empty", () => {
    const onAdd = vi.fn();
    render(<AddItemForm onAdd={onAdd} onCancel={vi.fn()} />);

    const form = screen.getByPlaceholderText(/Descrição/).closest("form")!;
    fireEvent.submit(form);

    expect(onAdd).not.toHaveBeenCalled();
  });

  describe("haptics", () => {
    it("triggers haptics.selectionChanged on increment", async () => {
      const user = userEvent.setup();
      render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

      await user.click(screen.getByLabelText("Aumentar quantidade"));
      expect(haptics.selectionChanged).toHaveBeenCalledOnce();
    });

    it("triggers haptics.selectionChanged on decrement when above min", async () => {
      const user = userEvent.setup();
      render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

      await user.click(screen.getByLabelText("Aumentar quantidade"));
      vi.clearAllMocks();
      await user.click(screen.getByLabelText("Diminuir quantidade"));
      expect(haptics.selectionChanged).toHaveBeenCalledOnce();
    });
  });
});
