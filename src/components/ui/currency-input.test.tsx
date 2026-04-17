import { describe, it, expect } from "vitest";
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

  it("respects maxCents", () => {
    function MaxWrapper() {
      const [cents, setCents] = useState(0);
      return <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={5000} data-testid="ci" />;
    }
    render(<MaxWrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "100,00" } });
    expect(input.value).toBe("50,00");
  });
});
