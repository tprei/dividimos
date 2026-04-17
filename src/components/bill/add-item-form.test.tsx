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

    expect(screen.getByText("Adicionar item")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Descrição/)).toBeInTheDocument();
    expect(screen.getByText("Preço unitário (R$)")).toBeInTheDocument();
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

  it("calls onCancel when cancel button clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AddItemForm onAdd={vi.fn()} onCancel={onCancel} />);

    const buttons = screen.getAllByRole("button");
    const cancelBtn = buttons.find(
      (b) => b.getAttribute("type") === "button",
    );
    expect(cancelBtn).toBeDefined();
    await user.click(cancelBtn!);

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
