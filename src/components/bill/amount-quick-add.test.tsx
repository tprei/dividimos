import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AmountQuickAdd } from "./amount-quick-add";

describe("AmountQuickAdd", () => {
  it("renders default increment chips", () => {
    render(<AmountQuickAdd currentValue="" onChange={vi.fn()} />);
    expect(screen.getByText("+R$1")).toBeInTheDocument();
    expect(screen.getByText("+R$5")).toBeInTheDocument();
    expect(screen.getByText("+R$10")).toBeInTheDocument();
    expect(screen.getByText("+R$50")).toBeInTheDocument();
    expect(screen.getByText("+R$100")).toBeInTheDocument();
  });

  it("renders custom increments", () => {
    render(<AmountQuickAdd increments={[2, 20]} currentValue="" onChange={vi.fn()} />);
    expect(screen.getByText("+R$2")).toBeInTheDocument();
    expect(screen.getByText("+R$20")).toBeInTheDocument();
    expect(screen.queryByText("+R$1")).not.toBeInTheDocument();
  });

  it("adds increment to empty value (treats as 0)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountQuickAdd currentValue="" onChange={onChange} />);

    await user.click(screen.getByText("+R$10"));
    expect(onChange).toHaveBeenCalledWith("10,00");
  });

  it("adds increment to existing Brazilian-format value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AmountQuickAdd currentValue="25,50" onChange={onChange} />);

    await user.click(screen.getByText("+R$5"));
    expect(onChange).toHaveBeenCalledWith("30,50");
  });

  it("handles multiple clicks accumulating value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AmountQuickAdd currentValue="" onChange={onChange} />,
    );

    await user.click(screen.getByText("+R$10"));
    expect(onChange).toHaveBeenCalledWith("10,00");

    rerender(<AmountQuickAdd currentValue="10,00" onChange={onChange} />);
    await user.click(screen.getByText("+R$50"));
    expect(onChange).toHaveBeenCalledWith("60,00");
  });

  it("has correct aria-labels in Portuguese", () => {
    render(<AmountQuickAdd currentValue="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Adicionar R$1")).toBeInTheDocument();
    expect(screen.getByLabelText("Adicionar R$100")).toBeInTheDocument();
  });

  it("all buttons have type=button to prevent form submission", () => {
    render(<AmountQuickAdd currentValue="" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn).toHaveAttribute("type", "button");
    }
  });

  it("does not show undo button initially", () => {
    render(<AmountQuickAdd currentValue="" onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Desfazer")).not.toBeInTheDocument();
  });

  it("shows undo button after a quick-add click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AmountQuickAdd currentValue="" onChange={onChange} />,
    );

    await user.click(screen.getByText("+R$10"));
    rerender(<AmountQuickAdd currentValue="10,00" onChange={onChange} />);

    expect(screen.getByLabelText("Desfazer")).toBeInTheDocument();
  });

  it("restores previous value on undo", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AmountQuickAdd currentValue="5,00" onChange={onChange} />,
    );

    await user.click(screen.getByText("+R$10"));
    rerender(<AmountQuickAdd currentValue="15,00" onChange={onChange} />);

    await user.click(screen.getByLabelText("Desfazer"));
    expect(onChange).toHaveBeenLastCalledWith("5,00");
  });

  it("supports multiple undos in sequence", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AmountQuickAdd currentValue="" onChange={onChange} />,
    );

    await user.click(screen.getByText("+R$10"));
    rerender(<AmountQuickAdd currentValue="10,00" onChange={onChange} />);

    await user.click(screen.getByText("+R$50"));
    rerender(<AmountQuickAdd currentValue="60,00" onChange={onChange} />);

    await user.click(screen.getByLabelText("Desfazer"));
    expect(onChange).toHaveBeenLastCalledWith("10,00");
    rerender(<AmountQuickAdd currentValue="10,00" onChange={onChange} />);

    await user.click(screen.getByLabelText("Desfazer"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
