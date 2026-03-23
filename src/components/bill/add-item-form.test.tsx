import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddItemForm } from "./add-item-form";

describe("AddItemForm", () => {
  it("renders form fields", () => {
    render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("Adicionar item")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Descricao/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0,00")).toBeInTheDocument();
  });

  it("renders quantity input with default value of 1", () => {
    render(<AddItemForm onAdd={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
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

    const form = screen.getByPlaceholderText(/Descricao/).closest("form")!;
    fireEvent.submit(form);

    expect(onAdd).not.toHaveBeenCalled();
  });
});
