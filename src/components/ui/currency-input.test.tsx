import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrencyInput } from "./currency-input";
import { useState } from "react";

function Wrapper({ initial = 0, maxCents }: { initial?: number; maxCents?: number }) {
  const [cents, setCents] = useState(initial);
  return <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={maxCents} data-testid="ci" />;
}

describe("CurrencyInput", () => {
  it("parses dot decimal 10.50 and 10.5 as 1050 cents identically to 10,50", () => {
    const onChangeCents = vi.fn();
    render(<CurrencyInput valueCents={0} onChangeCents={onChangeCents} data-testid="ci" />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10.50" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(1050);

    fireEvent.change(input, { target: { value: "10.5" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(1050);

    fireEvent.change(input, { target: { value: "10,50" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(1050);
  });

  it("replaces entire text on select-all without ATM digit shifting", () => {
    const onChangeCents = vi.fn();
    render(<CurrencyInput valueCents={5000} onChangeCents={onChangeCents} data-testid="ci" />);
    const input = screen.getByTestId("ci") as HTMLInputElement;
    expect(input.value).toBe("50,00");

    fireEvent.change(input, { target: { value: "10,50" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(1050);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("rejects malformed grouping 1.23.456 without silent repair", () => {
    const onChangeCents = vi.fn();
    render(<CurrencyInput valueCents={0} onChangeCents={onChangeCents} data-testid="ci" />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1.23.456" } });
    expect(onChangeCents).not.toHaveBeenCalled();
    expect(input.value).toBe("1.23.456");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("accepts bare decimals ,50 and .50 as 50 cents", () => {
    const onChangeCents = vi.fn();
    render(<CurrencyInput valueCents={0} onChangeCents={onChangeCents} data-testid="ci" />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: ",50" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(50);

    fireEvent.change(input, { target: { value: ".50" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(50);
  });

  it("parses thousands grouping 1.234 and 1.234,56 exactly", () => {
    const onChangeCents = vi.fn();
    render(<CurrencyInput valueCents={0} onChangeCents={onChangeCents} data-testid="ci" />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1.234" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(123400);

    fireEvent.change(input, { target: { value: "1.234,56" } });
    expect(onChangeCents).toHaveBeenLastCalledWith(123456);
  });

  it("canonicalizes valid text to Brazilian format on blur", () => {
    render(<Wrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10.5" } });
    expect(input.value).toBe("10,50");
    fireEvent.blur(input);
    expect(input.value).toBe("10,50");
  });

  it("keeps malformed text visible on blur", () => {
    render(<Wrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10,505" } });
    expect(input.value).toBe("10,505");
    fireEvent.blur(input);
    expect(input.value).toBe("10,505");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not commit an over-cap value and clears it after a valid edit", () => {
    function MaxWrapper() {
      const [cents, setCents] = useState(0);
      return <CurrencyInput valueCents={cents} onChangeCents={setCents} maxCents={5000} data-testid="ci" />;
    }
    render(<MaxWrapper />);
    const input = screen.getByTestId("ci") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "100,00" } });
    expect(input.value).toBe("100,00");
    expect(input).toHaveAttribute("aria-invalid", "true");

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
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByTestId("reset"));
    expect(input.value).toBe("20,00");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
