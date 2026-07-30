import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrencyInput } from "./currency-input";
import { useState } from "react";

function Wrapper({ initial = 0 }: { initial?: number }) {
  const [cents, setCents] = useState(initial);
  return <CurrencyInput valueCents={cents} onChangeCents={setCents} data-testid="ci" />;
}

describe("CurrencyInput", () => {
  it("responds to keyDown digit events (ATM-style)", () => {
    render(<Wrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;
    expect(input.value).toBe("0,00");

    fireEvent.keyDown(input, { key: "5" });
    expect(input.value).toBe("0,05");

    fireEvent.keyDown(input, { key: "0" });
    expect(input.value).toBe("0,50");

    fireEvent.keyDown(input, { key: "0" });
    expect(input.value).toBe("5,00");

    fireEvent.keyDown(input, { key: "0" });
    expect(input.value).toBe("50,00");
  });

  it("handles backspace", () => {
    render(<Wrapper initial={5000} />);
    const input = screen.getByTestId("ci") as HTMLInputElement;
    expect(input.value).toBe("50,00");

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("5,00");

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("0,50");
  });

  it("responds to change events with Brazilian format", () => {
    render(<Wrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "42,50" } });
    expect(input.value).toBe("42,50");

    fireEvent.change(input, { target: { value: "100,00" } });
    expect(input.value).toBe("100,00");
  });

  it("does not commit an out-of-range value — no store mutation, invalid state exposed (#477)", () => {
    function MaxWrapper() {
      const [cents, setCents] = useState(0);
      return <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={5000} data-testid="ci" />;
    }
    render(<MaxWrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "100,00" } });
    // Raw typed text is still shown (uncommitted override) and flagged
    // invalid, but the committed store value never mutated — no clamp,
    // no silent commit of an out-of-range value.
    expect(input.value).toBe("100,00");
    expect(input).toHaveAttribute("aria-invalid");

    // A subsequent in-range edit commits normally and clears the override.
    fireEvent.change(input, { target: { value: "30,00" } });
    expect(input.value).toBe("30,00");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("never calls onChangeCents for an out-of-range candidate", () => {
    const onChangeCents = vi.fn();
    render(
      <CurrencyInput valueCents={0} onChangeCents={onChangeCents} maxCents={5000} data-testid="ci" />,
    );
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "100,00" } });
    expect(onChangeCents).not.toHaveBeenCalled();
  });

  it("restores canonical valid text when the value prop changes externally", () => {
    function MaxWrapper() {
      const [cents, setCents] = useState(1000);
      return (
        <>
          <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={5000} data-testid="ci" />
          <button data-testid="reset" onClick={() => setCents(2000)}>reset</button>
        </>
      );
    }
    render(<MaxWrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "999999,00" } });
    expect(input).toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByTestId("reset"));
    expect(input.value).toBe("20,00");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("backspace from an invalid override recovers to a valid committed value", () => {
    function MaxWrapper() {
      const [cents, setCents] = useState(0);
      return <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={500} data-testid="ci" />;
    }
    render(<MaxWrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    // 0 -> 9 (9c) -> 99 (99c) -> 999 (over 500=invalid override)
    fireEvent.keyDown(input, { key: "9" });
    fireEvent.keyDown(input, { key: "9" });
    fireEvent.keyDown(input, { key: "9" });
    expect(input).toHaveAttribute("aria-invalid");

    // Backspace off the last digit: 999 -> 99 (within 500)
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("0,99");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
