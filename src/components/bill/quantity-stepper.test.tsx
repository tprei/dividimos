import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuantityStepper } from "./quantity-stepper";

describe("QuantityStepper", () => {
  it("renders value and buttons", () => {
    render(<QuantityStepper value="3" onChange={vi.fn()} />);

    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    expect(screen.getByLabelText("Diminuir quantidade")).toBeInTheDocument();
    expect(screen.getByLabelText("Aumentar quantidade")).toBeInTheDocument();
  });

  it("increments value on plus click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="2" onChange={onChange} />);

    await user.click(screen.getByLabelText("Aumentar quantidade"));

    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("decrements value on minus click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="3" onChange={onChange} />);

    await user.click(screen.getByLabelText("Diminuir quantidade"));

    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("disables minus button at min value", () => {
    render(<QuantityStepper value="1" onChange={vi.fn()} min={1} />);

    const minusBtn = screen.getByLabelText("Diminuir quantidade");
    expect(minusBtn).toBeDisabled();
  });

  it("does not decrement below min", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="1" onChange={onChange} min={1} />);

    await user.click(screen.getByLabelText("Diminuir quantidade"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows typing a custom value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "5");

    expect(onChange).toHaveBeenCalledWith("5");
  });

  it("rejects non-numeric input in integer mode", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="2" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "a");

    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("a"));
  });

  it("accepts decimal input when allowDecimal is true", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="" onChange={onChange} allowDecimal />);

    const input = screen.getByRole("textbox");
    await user.type(input, "1.5");

    expect(onChange).toHaveBeenCalledWith("1");
    expect(onChange).toHaveBeenCalledWith(".");
    expect(onChange).toHaveBeenCalledWith("5");
  });

  it("uses custom step value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityStepper value="2" onChange={onChange} step={5} />);

    await user.click(screen.getByLabelText("Aumentar quantidade"));

    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("uses decimal inputMode when allowDecimal is true", () => {
    render(<QuantityStepper value="1" onChange={vi.fn()} allowDecimal />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("uses numeric inputMode by default", () => {
    render(<QuantityStepper value="1" onChange={vi.fn()} />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });
});
